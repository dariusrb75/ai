/**
 * Offline chess client. Runs unchanged on both phones: the Android host loads it from
 * 127.0.0.1, the iPhone guest from the hotspot IP.
 *
 * The server owns the move log and the clocks but knows no chess. This file is where the rules
 * live (via chess.js), and it is the single rules implementation in the project — which is why
 * the two phones can never disagree about whether a move was legal.
 *
 * Pass-and-play is handled here as a mode flag rather than a separate module, so both modes go
 * through exactly one render pipeline and cannot drift apart.
 */

import { Chess } from './vendor/chess.js';
import { BoardView } from './board.js';
import { Clocks, formatClock } from './clock.js';
import { Connection, savedName, saveName } from './net.js';

const el = (id) => document.getElementById(id);

const dom = {
  joinScreen: el('joinScreen'),
  gameScreen: el('gameScreen'),
  nameInput: el('nameInput'),
  colorSelect: el('colorSelect'),
  joinBtn: el('joinBtn'),
  localBtn: el('localBtn'),

  board: el('board'),
  topBar: el('topBar'),
  topName: el('topName'),
  topColor: el('topColor'),
  topClock: el('topClock'),
  topDot: el('topDot'),
  bottomBar: el('bottomBar'),
  bottomName: el('bottomName'),
  bottomColor: el('bottomColor'),
  bottomClock: el('bottomClock'),
  bottomDot: el('bottomDot'),

  status: el('status'),
  offerBar: el('offerBar'),
  offerText: el('offerText'),
  offerAccept: el('offerAccept'),
  offerDecline: el('offerDecline'),
  movesList: el('movesList'),
  flipBtn: el('flipBtn'),

  takebackBtn: el('takebackBtn'),
  drawBtn: el('drawBtn'),
  resignBtn: el('resignBtn'),
  newGameBtn: el('newGameBtn'),

  sheet: el('sheet'),
  sheetTitle: el('sheetTitle'),
  sheetBody: el('sheetBody'),
  sheetActions: el('sheetActions'),

  about: el('about'),
  aboutBtn: el('aboutBtn'),
  aboutClose: el('aboutClose'),
};

/** 'net' once connected to a host, 'local' for pass-and-play on one phone. */
let mode = null;

let game = new Chess();
let state = null;
let myColor = null;
let seatKind = 'spectator';
let orientation = 'w';
let manualFlip = false;
let link = 'offline';
let connection = null;
const clocks = new Clocks();

/** Set while the promotion dialog is open, to keep a second move from starting. */
let awaitingPromotion = false;

/**
 * Created only once the game screen is visible. cm-chessboard measures its container on
 * construction, and a container inside `display: none` measures zero — which yields a board
 * with no size at all.
 */
let board = null;

function ensureBoard() {
  if (board) return;
  board = new BoardView(dom.board, {
    onMoveAttempt: handleMoveAttempt,
    onMoveStart: handleMoveStart,
    onMoveEnd: () => board.clearLegalMarkers(),
  });
}

// ---------------------------------------------------------------- rules helpers

/** Rebuilds a Chess instance by replaying UCI moves, so castling rights and repetition
 *  history are correct rather than inferred from a bare FEN. */
function rebuildGame(moves) {
  const rebuilt = new Chess();
  for (const record of moves) {
    const move = {
      from: record.uci.slice(0, 2),
      to: record.uci.slice(2, 4),
    };
    if (record.uci.length > 4) move.promotion = record.uci.charAt(4);
    try {
      rebuilt.move(move);
    } catch (e) {
      // A move we can't replay means the log is bad; stop rather than throwing away the rest.
      console.warn('could not replay move', record, e);
      break;
    }
  }
  return rebuilt;
}

function uciOf(move) {
  return move.from + move.to + (move.promotion || '');
}

/** The square of the king that is currently in check, or null. */
function checkedKingSquare(chess) {
  if (!chess.inCheck()) return null;
  const turn = chess.turn();
  for (const row of chess.board()) {
    for (const square of row) {
      if (square && square.type === 'k' && square.color === turn) return square.square;
    }
  }
  return null;
}

/** Outcomes the rules engine can determine on its own. */
function detectEnd(chess) {
  if (chess.isCheckmate()) {
    return { winner: chess.turn() === 'w' ? 'b' : 'w', reason: 'checkmate' };
  }
  if (chess.isStalemate()) return { winner: null, reason: 'stalemate' };
  if (chess.isInsufficientMaterial()) return { winner: null, reason: 'insufficient' };
  if (chess.isThreefoldRepetition()) return { winner: null, reason: 'threefold' };
  if (chess.isDrawByFiftyMoves()) return { winner: null, reason: 'fifty_move' };
  if (chess.isDraw()) return { winner: null, reason: 'draw' };
  return null;
}

// ---------------------------------------------------------------- move input

function myTurn() {
  if (!state || state.status !== 'active') return false;
  if (seatKind !== 'player') return false;
  return state.sideToMove === myColor;
}

function handleMoveStart(square) {
  if (awaitingPromotion) return false;
  const legal = game.moves({ square, verbose: true });
  if (legal.length === 0) return false;
  board.setMarkers({
    lastMove: lastMoveSquares(),
    check: checkedKingSquare(game),
    legal: legal.map((m) => m.to),
  });
  return true;
}

/**
 * Validates against chess.js, then applies optimistically and tells the server.
 *
 * Optimistic application is what makes the board feel instant; the server's next state
 * broadcast is still the authority, and a rejected move gets rolled back when it arrives.
 */
function handleMoveAttempt(from, to) {
  if (awaitingPromotion) return false;

  const candidates = game.moves({ square: from, verbose: true })
    .filter((m) => m.to === to);
  if (candidates.length === 0) return false;

  const promotion = candidates.find((m) => m.promotion);
  if (promotion) {
    awaitingPromotion = true;
    board.askPromotion(to, game.turn(), (piece) => {
      awaitingPromotion = false;
      if (!piece) {
        // Cancelled: put the board back the way it was.
        board.setPosition(game.fen(), false);
        renderMarkers();
        return;
      }
      commitMove({ from, to, promotion: piece });
    });
    // Returning true lets cm-chessboard place the pawn on the promotion square while the
    // dialog is open, which is what the dialog renders on top of.
    return true;
  }

  commitMove({ from, to });
  return true;
}

function commitMove(request) {
  let move;
  try {
    move = game.move(request);
  } catch (e) {
    console.warn('illegal move slipped through validation', request, e);
    return;
  }

  if (mode === 'local') {
    syncLocalState();
    render(false);
    return;
  }

  const ply = game.history().length - 1;
  const sent = connection.send({
    t: 'move',
    ply,
    uci: uciOf(move),
    san: move.san,
    fen: game.fen(),
  });

  if (!sent) {
    // No link: undo so the board never shows a move the opponent will never see.
    game.undo();
    board.setPosition(game.fen(), false);
    setStatus('Not connected — move not sent', 'alert');
    return;
  }

  // Render the optimistic position now; the server's broadcast will confirm it.
  render(false);
}

// ---------------------------------------------------------------- rendering

function lastMoveSquares() {
  const history = game.history({ verbose: true });
  if (history.length === 0) return null;
  const last = history[history.length - 1];
  return { from: last.from, to: last.to };
}

function renderMarkers() {
  board.setMarkers({
    lastMove: lastMoveSquares(),
    check: checkedKingSquare(game),
  });
}

function render(animate) {
  if (!state) return;

  if (!manualFlip) {
    // Each player sees their own pieces at the bottom; in pass-and-play the board follows
    // whoever is to move, since two people are sharing one screen.
    orientation = mode === 'local' ? state.sideToMove : (myColor || 'w');
  }
  board.setOrientation(orientation);
  board.setPosition(state.fen, animate);
  renderMarkers();

  const inputAllowed = mode === 'local'
    ? (state.status === 'active' ? state.sideToMove : null)
    : (myTurn() ? myColor : null);
  board.setInputColor(inputAllowed);

  renderPlayers();
  renderClocks();
  renderMoves();
  renderStatus();
  renderControls();
  renderOffer();
}

function renderPlayers() {
  // Bottom is always "me" (or white, in pass-and-play).
  const bottomColor = orientation;
  const topColor = bottomColor === 'w' ? 'b' : 'w';

  const nameFor = (color) => {
    const name = color === 'w' ? state.whiteName : state.blackName;
    if (name) return name;
    return mode === 'local' ? (color === 'w' ? 'White' : 'Black') : 'Waiting…';
  };
  const connectedFor = (color) =>
    mode === 'local' ? true : (color === 'w' ? state.whiteConnected : state.blackConnected);

  dom.bottomName.textContent = nameFor(bottomColor);
  dom.topName.textContent = nameFor(topColor);
  dom.bottomColor.textContent = bottomColor === 'w' ? 'White' : 'Black';
  dom.topColor.textContent = topColor === 'w' ? 'White' : 'Black';

  dom.bottomDot.classList.toggle('online', connectedFor(bottomColor));
  dom.topDot.classList.toggle('online', connectedFor(topColor));

  const active = state.status === 'active';
  dom.bottomBar.classList.toggle('to-move', active && state.sideToMove === bottomColor);
  dom.topBar.classList.toggle('to-move', active && state.sideToMove === topColor);
}

function renderClocks() {
  const bottomColor = orientation;
  const topColor = bottomColor === 'w' ? 'b' : 'w';

  const paint = (node, color) => {
    node.textContent = formatClock(clocks.remaining(color), clocks.unlimited);
    const isRunning = clocks.running && state.sideToMove === color && state.status === 'active';
    node.classList.toggle('running', isRunning && !clocks.isLow(color));
    node.classList.toggle('low', clocks.isLow(color));
    // A stopped clock on the mover's side means their phone is away — say so visually rather
    // than letting it look like a running clock that happens to be frozen.
    const stalled = state.status === 'active' &&
      state.sideToMove === color &&
      !clocks.running &&
      !clocks.unlimited;
    node.classList.toggle('paused', stalled);
  };

  paint(dom.bottomClock, bottomColor);
  paint(dom.topClock, topColor);
}

function renderMoves() {
  const moves = state.moves || [];
  if (moves.length === 0) {
    dom.movesList.innerHTML = '<li class="moves-empty">No moves yet</li>';
    return;
  }

  const rows = [];
  for (let i = 0; i < moves.length; i += 2) {
    const number = i / 2 + 1;
    const white = moves[i] ? moves[i].san : '';
    const black = moves[i + 1] ? moves[i + 1].san : '';
    rows.push(
      `<li><span class="num">${number}.</span>` +
      `<span class="san w">${white}</span>` +
      `<span class="san">${black}</span></li>`,
    );
  }
  dom.movesList.innerHTML = rows.join('');
  // Keep the latest move in view.
  dom.movesList.scrollTop = dom.movesList.scrollHeight;
}

const END_REASONS = {
  checkmate: 'checkmate',
  resignation: 'resignation',
  timeout: 'time',
  agreement: 'agreement',
  stalemate: 'stalemate',
  threefold: 'threefold repetition',
  fifty_move: 'the fifty-move rule',
  insufficient: 'insufficient material',
  draw: 'a draw',
};

function describeResult() {
  const reason = END_REASONS[state.resultReason] || state.resultReason || 'unknown';
  if (!state.resultWinner) {
    return state.resultReason === 'agreement'
      ? 'Draw by agreement'
      : `Draw by ${reason}`;
  }
  const winner = state.resultWinner === 'w' ? 'White' : 'Black';
  const isMe = mode !== 'local' && state.resultWinner === myColor;
  const who = mode === 'local' ? winner : (isMe ? 'You win' : `${winner} wins`);
  return `${who} by ${reason}`;
}

function setStatus(text, kind) {
  dom.status.textContent = text;
  dom.status.className = 'status' + (kind ? ` ${kind}` : '');
}

function renderStatus() {
  if (state.status === 'finished') {
    setStatus(describeResult(), 'over');
    return;
  }

  if (mode === 'net' && link !== 'online') {
    setStatus(link === 'connecting' ? 'Reconnecting…' : 'Connection lost — retrying', 'alert');
    return;
  }

  if (state.status === 'waiting') {
    setStatus('Waiting for the other player to join…', 'alert');
    return;
  }

  if (seatKind === 'spectator') {
    const side = state.sideToMove === 'w' ? 'White' : 'Black';
    setStatus(`Watching — ${side} to move`, null);
    return;
  }

  const check = game.inCheck() ? ' — check!' : '';

  if (mode === 'local') {
    const side = state.sideToMove === 'w' ? 'White' : 'Black';
    setStatus(`${side} to move${check}`, check ? 'alert' : null);
    return;
  }

  // A paused clock on your opponent's turn is worth explaining, or it looks like a freeze.
  if (!myTurn()) {
    const opponentAway = state.sideToMove === 'w'
      ? !state.whiteConnected
      : !state.blackConnected;
    if (opponentAway) {
      setStatus('Opponent is away — their clock is paused', 'alert');
      return;
    }
    setStatus(`Opponent to move${check}`, null);
    return;
  }

  setStatus(`Your move${check}`, check ? 'alert' : null);
}

function renderControls() {
  const isPlayer = seatKind === 'player' || mode === 'local';
  const active = state.status === 'active';
  document.body.classList.toggle('spectating', !isPlayer);

  if (mode === 'local') {
    // Pass-and-play has no opponent to negotiate with, so these collapse to a plain undo.
    dom.takebackBtn.textContent = 'Undo';
    dom.takebackBtn.disabled = state.ply === 0;
    dom.drawBtn.disabled = true;
    dom.resignBtn.disabled = !active;
    return;
  }

  dom.takebackBtn.textContent = 'Takeback';
  const iHaveMoved = myColor === 'w' ? state.ply >= 1 : state.ply >= 2;
  dom.takebackBtn.disabled = !isPlayer || !iHaveMoved || !!state.pendingTakebackBy;
  dom.drawBtn.disabled = !isPlayer || !active || !!state.pendingDrawBy;
  dom.resignBtn.disabled = !isPlayer || !active;
}

/** Shows the Accept/Decline bar only for an offer made *by the opponent*. */
function renderOffer() {
  if (mode === 'local' || seatKind !== 'player') {
    dom.offerBar.classList.add('hidden');
    return;
  }

  const opponent = myColor === 'w' ? 'b' : 'w';
  let text = null;
  let kind = null;

  if (state.pendingTakebackBy === opponent) {
    text = 'Opponent asks to take back a move';
    kind = 'takeback';
  } else if (state.pendingDrawBy === opponent) {
    text = 'Opponent offers a draw';
    kind = 'draw';
  }

  if (!text) {
    // Show your own pending request as a passive note.
    if (state.pendingTakebackBy === myColor || state.pendingDrawBy === myColor) {
      dom.offerText.textContent = state.pendingTakebackBy === myColor
        ? 'Takeback requested — waiting for the opponent'
        : 'Draw offered — waiting for the opponent';
      dom.offerBar.classList.remove('hidden');
      dom.offerAccept.classList.add('hidden');
      dom.offerDecline.classList.add('hidden');
      return;
    }
    dom.offerBar.classList.add('hidden');
    return;
  }

  dom.offerText.textContent = text;
  dom.offerBar.dataset.kind = kind;
  dom.offerAccept.classList.remove('hidden');
  dom.offerDecline.classList.remove('hidden');
  dom.offerBar.classList.remove('hidden');
}

// ---------------------------------------------------------------- game over sheet

let lastShownResult = null;

function maybeShowResultSheet() {
  if (state.status !== 'finished') {
    lastShownResult = null;
    return;
  }
  const key = `${state.resultWinner}:${state.resultReason}:${state.ply}`;
  if (lastShownResult === key) return;
  lastShownResult = key;

  dom.sheetTitle.textContent = 'Game over';
  dom.sheetBody.textContent = describeResult();
  dom.sheetActions.innerHTML = '';

  const rematch = document.createElement('button');
  rematch.className = 'btn btn-primary';
  rematch.textContent = mode === 'local' ? 'Play again' : 'Rematch (swap colours)';
  rematch.onclick = () => {
    dom.sheet.classList.add('hidden');
    startNewGame();
  };

  const close = document.createElement('button');
  close.className = 'btn';
  close.textContent = 'Review the board';
  close.onclick = () => dom.sheet.classList.add('hidden');

  dom.sheetActions.append(rematch, close);
  dom.sheet.classList.remove('hidden');
}

// ---------------------------------------------------------------- local mode

function syncLocalState() {
  const history = game.history({ verbose: true });
  const end = detectEnd(game);
  state = {
    moves: history.map((m) => ({ uci: uciOf(m), san: m.san, fen: m.after })),
    fen: game.fen(),
    sideToMove: game.turn(),
    ply: history.length,
    status: end ? 'finished' : 'active',
    resultWinner: end ? end.winner : null,
    resultReason: end ? end.reason : null,
    whiteMs: null,
    blackMs: null,
    clockRunning: false,
    unlimited: true,
    incrementMs: 0,
    initialMs: 0,
    whiteName: 'White',
    blackName: 'Black',
    whiteConnected: true,
    blackConnected: true,
    pendingTakebackBy: null,
    pendingDrawBy: null,
  };
  clocks.sync(state);
  maybeShowResultSheet();
}

// ---------------------------------------------------------------- server events

function onState(snapshot) {
  const previousPly = state ? state.ply : -1;
  state = snapshot;

  // Rebuild only when the local mirror has actually diverged. Skipping this when we already
  // match keeps our own just-played move from being re-applied and re-animated.
  const diverged = game.history().length !== snapshot.ply ||
    (snapshot.ply > 0 && game.fen() !== snapshot.fen);
  if (diverged) game = rebuildGame(snapshot.moves);

  clocks.sync(snapshot);

  // Animate when a move arrived from the opponent, not when confirming our own.
  const animate = snapshot.ply === previousPly + 1 && diverged;
  render(animate);

  reportEndIfDetected();
  maybeShowResultSheet();
}

/**
 * The server cannot see checkmate, so a client has to tell it. Both clients will notice and
 * both may send; the server ignores the second because the game is no longer active.
 */
function reportEndIfDetected() {
  if (mode !== 'net' || seatKind !== 'player') return;
  if (!state || state.status !== 'active') return;
  const end = detectEnd(game);
  if (!end) return;
  connection.send({ t: 'game_over', winner: end.winner, reason: end.reason });
}

function onWelcome(msg) {
  seatKind = msg.seat;
  myColor = msg.color || null;
  manualFlip = false;
}

function onLink(next) {
  link = next;
  if (state) {
    renderStatus();
    renderPlayers();
  } else if (next === 'connecting') {
    setStatus('Connecting to the host…', 'alert');
  }
}

function onServerError(message) {
  // ply_mismatch and not_your_turn are normal consequences of a flaky link; the state message
  // that follows resyncs us, so they don't need to be shown to the player.
  const quiet = ['ply_mismatch', 'not_your_turn', 'game_not_active', 'no_hello'];
  if (quiet.includes(message)) return;
  if (message === 'flagged') {
    setStatus('Out of time', 'alert');
    return;
  }
  console.warn('server error:', message);
}

// ---------------------------------------------------------------- actions

function startNewGame() {
  if (mode === 'local') {
    game = new Chess();
    lastShownResult = null;
    syncLocalState();
    render(false);
    return;
  }
  connection.send({ t: 'newgame', timeControl: null });
}

function wireControls() {
  dom.flipBtn.onclick = () => {
    manualFlip = true;
    orientation = orientation === 'w' ? 'b' : 'w';
    render(false);
  };

  dom.takebackBtn.onclick = () => {
    if (mode === 'local') {
      game.undo();
      lastShownResult = null;
      syncLocalState();
      render(false);
      return;
    }
    connection.send({ t: 'takeback_request' });
  };

  dom.drawBtn.onclick = () => {
    if (mode === 'local') return;
    connection.send({ t: 'draw_offer' });
  };

  dom.resignBtn.onclick = () => {
    if (!confirm('Resign this game?')) return;
    if (mode === 'local') {
      // In pass-and-play, whoever is to move is the one giving up.
      state.status = 'finished';
      state.resultWinner = state.sideToMove === 'w' ? 'b' : 'w';
      state.resultReason = 'resignation';
      render(false);
      maybeShowResultSheet();
      return;
    }
    connection.send({ t: 'resign' });
  };

  dom.newGameBtn.onclick = () => {
    const message = mode === 'local'
      ? 'Start a new game?'
      : 'Start a new game? Colours will swap.';
    if (state && state.ply > 0 && state.status === 'active' && !confirm(message)) return;
    startNewGame();
  };

  const respond = (accept) => {
    const kind = dom.offerBar.dataset.kind;
    if (kind === 'takeback') connection.send({ t: 'takeback_response', accept });
    if (kind === 'draw') connection.send({ t: 'draw_response', accept });
  };
  dom.offerAccept.onclick = () => respond(true);
  dom.offerDecline.onclick = () => respond(false);

  dom.aboutBtn.onclick = () => dom.about.classList.remove('hidden');
  dom.aboutClose.onclick = () => dom.about.classList.add('hidden');
}

// ---------------------------------------------------------------- startup

function showGameScreen() {
  dom.joinScreen.classList.add('hidden');
  dom.gameScreen.classList.remove('hidden');
  ensureBoard();
}

function startNetworkGame(name, preferredColor) {
  mode = 'net';
  saveName(name);
  showGameScreen();

  connection = new Connection({ onState, onWelcome, onLink, onServerError, onClock: (msg) => {
    clocks.sync({ ...msg, sideToMove: state ? state.sideToMove : 'w' });
    if (state) renderClocks();
  } });
  connection.connect(name, preferredColor);
}

function startLocalGame() {
  mode = 'local';
  seatKind = 'player';
  myColor = null;
  showGameScreen();
  game = new Chess();
  syncLocalState();
  render(false);
}

function init() {
  wireControls();

  const params = new URLSearchParams(location.search);
  const presetName = params.get('name');
  const presetColor = params.get('color');

  dom.nameInput.value = presetName || savedName() || '';
  if (presetColor === 'w' || presetColor === 'b') dom.colorSelect.value = presetColor;

  dom.joinBtn.onclick = () => {
    const name = (dom.nameInput.value || 'Player').trim().slice(0, 16) || 'Player';
    startNetworkGame(name, dom.colorSelect.value);
  };
  dom.localBtn.onclick = startLocalGame;

  dom.nameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') dom.joinBtn.click();
  });

  // The Android host opens the WebView with ?name=…&autojoin=1, so the player who is already
  // looking at the setup screen in the app isn't asked for a name a second time.
  if (params.get('autojoin') === '1' && presetName) {
    startNetworkGame(presetName, presetColor || '');
  }

  // Smooth the countdown between server syncs.
  setInterval(() => {
    if (state && mode) renderClocks();
  }, 200);

  // Coming back from a locked screen or a backgrounded tab: reconnect immediately instead of
  // waiting out the backoff. This is the common case outdoors.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && mode === 'net' && connection) connection.reconnectNow();
  });
  window.addEventListener('online', () => {
    if (mode === 'net' && connection) connection.reconnectNow();
  });
}

init();
