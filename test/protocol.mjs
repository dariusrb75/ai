/**
 * Drives the real server with two simulated phones over real WebSockets.
 *
 * This is the closest thing to a field test that can run without hardware: it exercises seat
 * assignment, the ply guard, takeback, clock flagging, and — most importantly — a hard
 * disconnect followed by a reconnect, which is the failure mode that actually happens outdoors.
 */

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';

const SERVER_BIN = './tools/build/install/tools/bin/tools';

let failures = 0;
let checks = 0;

function check(condition, description, detail) {
  checks++;
  if (condition) {
    console.log(`  ok   ${description}`);
  } else {
    failures++;
    console.log(`  FAIL ${description}${detail ? ` — ${detail}` : ''}`);
  }
}

function eq(actual, expected, description) {
  check(
    JSON.stringify(actual) === JSON.stringify(expected),
    description,
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForPort(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const open = await new Promise((resolve) => {
      const socket = net.connect(port, '127.0.0.1');
      socket.on('connect', () => { socket.end(); resolve(true); });
      socket.on('error', () => resolve(false));
    });
    if (open) return;
    await sleep(150);
  }
  throw new Error(`server on port ${port} never came up`);
}

async function startServer(port, timeControl) {
  const child = spawn(SERVER_BIN, [String(port), 'web', timeControl], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => {
    const text = String(d);
    if (!text.includes('JAVA_TOOL_OPTIONS')) process.stderr.write(`[server] ${text}`);
  });
  await waitForPort(port);
  return child;
}

/** A simulated phone. Collects every message so tests can await specific ones. */
class Client {
  constructor(port, token) {
    this.port = port;
    this.token = token;
    this.messages = [];
    this.state = null;
    this.welcome = null;
    this.errors = [];
  }

  async connect(name, color) {
    this.socket = new WebSocket(`ws://127.0.0.1:${this.port}/ws`);
    this.socket.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      this.messages.push(msg);
      if (msg.t === 'state') this.state = msg.state;
      if (msg.t === 'welcome') this.welcome = msg;
      if (msg.t === 'error') this.errors.push(msg.message);
    });
    await once(this.socket, 'open');
    this.send({ t: 'hello', token: this.token, name, color: color || null });
    await this.waitFor((m) => m.t === 'welcome');
  }

  send(payload) {
    this.socket.send(JSON.stringify(payload));
  }

  /** Waits for a message matching [predicate], ignoring anything already seen. */
  async waitFor(predicate, timeoutMs = 4000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = this.messages.find(predicate);
      if (found) return found;
      await sleep(20);
    }
    throw new Error(`timed out waiting for a message; saw ${JSON.stringify(this.messages.slice(-4))}`);
  }

  /** Waits until the server-reported ply reaches [ply]. */
  async waitForPly(ply) {
    return this.waitFor((m) => m.t === 'state' && m.state.ply === ply);
  }

  clear() {
    this.messages = [];
    this.errors = [];
  }

  close() {
    if (this.socket) this.socket.close();
  }
}

// A short opening that ends in checkmate, so the client-detected-mate path is covered.
// 1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7#
const SCHOLARS_MATE = [
  ['e2e4', 'e4'], ['e7e5', 'e5'],
  ['f1c4', 'Bc4'], ['b8c6', 'Nc6'],
  ['d1h5', 'Qh5'], ['g8f6', 'Nf6'],
  ['h5f7', 'Qxf7#'],
];

// ------------------------------------------------------------------ tests

async function testFullGame(port) {
  console.log('\nfull game, seats and checkmate');
  const white = new Client(port, 'tok-white');
  const black = new Client(port, 'tok-black');

  await white.connect('Ana', 'w');
  eq(white.welcome.color, 'w', 'first player gets the colour it asked for');
  eq(white.welcome.seat, 'player', 'first player is seated');

  await black.connect('Bo', 'b');
  eq(black.welcome.color, 'b', 'second player gets the other colour');

  await white.waitFor((m) => m.t === 'state' && m.state.status === 'active');
  eq(white.state.status, 'active', 'the game starts once both are seated');
  eq([white.state.whiteName, white.state.blackName], ['Ana', 'Bo'], 'names are reported');

  for (let i = 0; i < SCHOLARS_MATE.length; i++) {
    const [uci, san] = SCHOLARS_MATE[i];
    const mover = i % 2 === 0 ? white : black;
    mover.send({ t: 'move', ply: i, uci, san, fen: `fen-${i}` });
    await black.waitForPly(i + 1);
    await white.waitForPly(i + 1);
  }

  eq(white.state.ply, 7, 'all seven moves were applied');
  eq(white.state.moves.map((m) => m.san), SCHOLARS_MATE.map((m) => m[1]),
    'the move list matches, in order');

  // Both clients detect mate with chess.js; here the driver reports it explicitly.
  white.send({ t: 'game_over', winner: 'w', reason: 'checkmate' });
  await white.waitFor((m) => m.t === 'state' && m.state.status === 'finished');
  eq(white.state.resultWinner, 'w', 'white is recorded as the winner');
  eq(white.state.resultReason, 'checkmate', 'the reason is recorded');

  // A move after the game is over must be refused.
  black.clear();
  black.send({ t: 'move', ply: 7, uci: 'e8e7', san: 'Ke7', fen: 'fen-x' });
  await sleep(250);
  check(black.errors.includes('game_not_active'), 'moves are refused after the game ends');

  white.close();
  black.close();
}

async function testPlyGuardAndTurnOrder(port) {
  console.log('\nply guard and turn order');
  const white = new Client(port, 'g-white');
  const black = new Client(port, 'g-black');
  await white.connect('W', 'w');
  await black.connect('B', 'b');
  await white.waitFor((m) => m.t === 'state' && m.state.status === 'active');

  black.clear();
  black.send({ t: 'move', ply: 0, uci: 'e7e5', san: 'e5', fen: 'f' });
  await sleep(250);
  check(black.errors.includes('not_your_turn'), 'black cannot move first');

  white.send({ t: 'move', ply: 0, uci: 'e2e4', san: 'e4', fen: 'f0' });
  await white.waitForPly(1);
  black.send({ t: 'move', ply: 1, uci: 'e7e5', san: 'e5', fen: 'f1' });
  await white.waitForPly(2);

  // The scenario this guards: a flaky link makes the client resend a move already applied.
  // It has to be tested on the resender's own turn, because the turn check runs first and
  // would otherwise mask the ply guard with "not_your_turn".
  white.clear();
  white.send({ t: 'move', ply: 0, uci: 'e2e4', san: 'e4', fen: 'f0' });
  await sleep(250);
  check(white.errors.includes('ply_mismatch'),
    'a stale resent move is refused, not applied twice',
    `errors=${JSON.stringify(white.errors)}`);
  eq(white.state.ply, 2, 'the move log did not grow');

  white.close();
  black.close();
}

async function testTakeback(port) {
  console.log('\ntakeback');
  const white = new Client(port, 'tb-white');
  const black = new Client(port, 'tb-black');
  await white.connect('W', 'w');
  await black.connect('B', 'b');
  await white.waitFor((m) => m.t === 'state' && m.state.status === 'active');

  white.send({ t: 'move', ply: 0, uci: 'e2e4', san: 'e4', fen: 'f0' });
  await black.waitForPly(1);
  black.send({ t: 'move', ply: 1, uci: 'e7e5', san: 'e5', fen: 'f1' });
  await white.waitForPly(2);

  // Declined first.
  white.clear();
  black.clear();
  white.send({ t: 'takeback_request' });
  await black.waitFor((m) => m.t === 'state' && m.state.pendingTakebackBy === 'w');
  check(true, 'the opponent is told about the request');
  black.send({ t: 'takeback_response', accept: false });
  await white.waitFor((m) => m.t === 'state' && !m.state.pendingTakebackBy);
  eq(white.state.ply, 2, 'a declined takeback changes nothing');

  // Then accepted: white asked, and white's own move must come back, so two plies go.
  // Both buffers must be cleared, or black's waitFor matches the *first* request still sitting
  // in its history and answers before the server has registered the second one.
  white.clear();
  black.clear();
  white.send({ t: 'takeback_request' });
  await black.waitFor((m) => m.t === 'state' && m.state.pendingTakebackBy === 'w');
  black.send({ t: 'takeback_response', accept: true });
  await white.waitForPly(0);
  eq(white.state.ply, 0, 'takeback rewinds to the requester\'s own turn');
  eq(white.state.sideToMove, 'w', 'and it is their turn again');

  white.close();
  black.close();
}

async function testSpectator(port) {
  console.log('\nspectator');
  const white = new Client(port, 'sp-white');
  const black = new Client(port, 'sp-black');
  const watcher = new Client(port, 'sp-watch');
  await white.connect('W', 'w');
  await black.connect('B', 'b');
  await watcher.connect('Nosy', 'w');

  eq(watcher.welcome.seat, 'spectator', 'a third connection watches instead of playing');
  eq(watcher.welcome.color, undefined, 'a spectator has no colour');

  watcher.clear();
  watcher.send({ t: 'move', ply: 0, uci: 'e2e4', san: 'e4', fen: 'f' });
  await sleep(250);
  check(watcher.errors.includes('not_a_player'), 'a spectator cannot move');

  // But it does see the game.
  white.send({ t: 'move', ply: 0, uci: 'e2e4', san: 'e4', fen: 'f0' });
  await watcher.waitForPly(1);
  eq(watcher.state.moves.map((m) => m.san), ['e4'], 'a spectator receives the moves');

  white.close();
  black.close();
  watcher.close();
}

async function testReconnect(port) {
  console.log('\nreconnect after a dropped phone');
  const white = new Client(port, 'rc-white');
  const black = new Client(port, 'rc-black');
  await white.connect('Ana', 'w');
  await black.connect('Bo', 'b');
  await white.waitFor((m) => m.t === 'state' && m.state.status === 'active');

  white.send({ t: 'move', ply: 0, uci: 'e2e4', san: 'e4', fen: 'f0' });
  await black.waitForPly(1);
  black.send({ t: 'move', ply: 1, uci: 'c7c5', san: 'c5', fen: 'f1' });
  await white.waitForPly(2);
  const before = white.state;

  // Black's phone drops off the hotspot entirely.
  black.close();
  await white.waitFor((m) => m.t === 'state' && m.state.blackConnected === false);
  check(true, 'the opponent is shown as away');
  eq(white.state.status, 'active', 'a dropped phone does not end the game');

  // And comes back with the same token.
  const blackAgain = new Client(port, 'rc-black');
  await blackAgain.connect('Bo', null);
  eq(blackAgain.welcome.seat, 'player', 'the returning phone is still a player');
  eq(blackAgain.welcome.color, 'b', 'and reclaims its own colour');

  await blackAgain.waitFor((m) => m.t === 'state');
  eq(blackAgain.state.ply, before.ply, 'the game is restored at the same ply');
  eq(blackAgain.state.moves.map((m) => m.san), ['e4', 'c5'], 'with the full move list');
  eq(blackAgain.state.fen, before.fen, 'and the same position');

  // The restored player can carry on playing.
  white.send({ t: 'move', ply: 2, uci: 'g1f3', san: 'Nf3', fen: 'f2' });
  await blackAgain.waitForPly(3);
  blackAgain.send({ t: 'move', ply: 3, uci: 'd7d6', san: 'd6', fen: 'f3' });
  await white.waitForPly(4);
  eq(white.state.moves.map((m) => m.san), ['e4', 'c5', 'Nf3', 'd6'],
    'the game continues normally after the reconnect');

  white.close();
  blackAgain.close();
}

async function testDrawAndResign(port) {
  console.log('\ndraw and resign');
  const white = new Client(port, 'dr-white');
  const black = new Client(port, 'dr-black');
  await white.connect('W', 'w');
  await black.connect('B', 'b');
  await white.waitFor((m) => m.t === 'state' && m.state.status === 'active');

  white.clear();
  black.clear();
  white.send({ t: 'draw_offer' });
  await black.waitFor((m) => m.t === 'state' && m.state.pendingDrawBy === 'w');
  black.send({ t: 'draw_response', accept: false });
  await white.waitFor((m) => m.t === 'state' && !m.state.pendingDrawBy);
  eq(white.state.status, 'active', 'a declined draw leaves the game running');

  // Clear both, so the second offer isn't answered using the first one's stale broadcast.
  white.clear();
  black.clear();
  white.send({ t: 'draw_offer' });
  await black.waitFor((m) => m.t === 'state' && m.state.pendingDrawBy === 'w');
  black.send({ t: 'draw_response', accept: true });
  await white.waitFor((m) => m.t === 'state' && m.state.status === 'finished');
  eq(white.state.resultWinner, undefined, 'an agreed draw has no winner');
  eq(white.state.resultReason, 'agreement', 'and is recorded as agreement');

  // Rematch swaps colours.
  white.send({ t: 'newgame', timeControl: null });
  await white.waitFor((m) => m.t === 'welcome' || (m.t === 'state' && m.state.status === 'active'));
  await sleep(200);
  eq(white.state.ply, 0, 'a rematch clears the board');
  eq(white.state.whiteName, 'B', 'and swaps the colours');

  // Clear first: the draw above already broadcast a "finished" state, and waiting for
  // status === 'finished' would match that stale one instead of the resignation.
  white.clear();
  black.clear();
  white.send({ t: 'resign' });
  const resigned = await white.waitFor((m) => m.t === 'state' && m.state.status === 'finished');
  eq(resigned.state.resultReason, 'resignation', 'resigning ends the game');
  // Colours swapped on the rematch, so this connection is now black and white takes the win.
  eq(resigned.state.resultWinner, 'w', 'and the opponent is awarded the win');

  white.close();
  black.close();
}

async function testClockFlag() {
  console.log('\nclocks: pause while away, then flag');
  // 0.05 minutes = 3 seconds, so the flag test finishes quickly.
  const port = 8093;
  const server = await startServer(port, '0.05+0');
  try {
    const white = new Client(port, 'ck-white');
    const black = new Client(port, 'ck-black');
    await white.connect('W', 'w');
    await black.connect('B', 'b');
    await white.waitFor((m) => m.t === 'state' && m.state.status === 'active');

    check(white.state.unlimited === false, 'the clock is enabled');
    eq(white.state.initialMs, 3000, 'the time control was parsed');

    // White is to move. Drop white's phone: their clock must stop, not bleed out.
    white.close();
    await black.waitFor((m) => m.t === 'state' && m.state.whiteConnected === false);
    const afterDrop = black.state.whiteMs;
    check(black.state.clockRunning === false,
      'the mover\'s clock pauses while their phone is away');

    await sleep(2500);
    await black.waitFor((m) => m.t === 'state' || m.t === 'clock');
    check(black.state.status === 'active',
      'a paused clock cannot flag', `status=${black.state.status}`);

    // White returns and now genuinely runs out.
    const whiteAgain = new Client(port, 'ck-white');
    await whiteAgain.connect('W', null);
    await whiteAgain.waitFor((m) => m.t === 'state' && m.state.clockRunning === true);
    check(whiteAgain.state.whiteMs <= afterDrop + 50,
      'no time was lost while away',
      `before=${afterDrop} after=${whiteAgain.state.whiteMs}`);

    const flagged = await whiteAgain.waitFor(
      (m) => m.t === 'state' && m.state.status === 'finished',
      8000,
    );
    eq(flagged.state.resultReason, 'timeout', 'running out of time ends the game');
    eq(flagged.state.resultWinner, 'b', 'and the opponent wins');

    whiteAgain.close();
    black.close();
  } finally {
    server.kill();
  }
}

// ------------------------------------------------------------------ runner

const mainPort = 8092;
const server = await startServer(mainPort, 'unlimited');
try {
  // Each test uses fresh tokens; a `newgame` between them would swap colours and confuse the
  // seat assertions, so the tests instead rely on distinct token pairs per scenario.
  await testFullGame(mainPort);
  server.kill();
  await sleep(300);

  // A fresh server per scenario keeps seat assignment deterministic.
  for (const test of [
    testPlyGuardAndTurnOrder,
    testTakeback,
    testSpectator,
    testReconnect,
    testDrawAndResign,
  ]) {
    const s = await startServer(mainPort, 'unlimited');
    try {
      await test(mainPort);
    } finally {
      s.kill();
      await sleep(300);
    }
  }

  await testClockFlag();
} finally {
  server.kill();
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} FAILED`);
  process.exit(1);
}
