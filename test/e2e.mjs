/**
 * End-to-end test through the real UI, with two browser contexts standing in for the two
 * phones. Plays actual games by clicking squares, so it covers the board, the rules engine, the
 * render pipeline and the wire protocol together.
 *
 * Only Chromium is available in this container, so the iPhone side is emulated by viewport and
 * user agent. That verifies layout and logic but is *not* a substitute for testing on real
 * iOS Safari — see docs/FIELD-GUIDE.md.
 */

import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { mkdirSync } from 'node:fs';

const SERVER_BIN = './tools/build/install/tools/bin/tools';
const PORT = 8094;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = 'test/screenshots';

let failures = 0;
let checks = 0;

function check(condition, description, detail) {
  checks++;
  if (condition) console.log(`  ok   ${description}`);
  else {
    failures++;
    console.log(`  FAIL ${description}${detail ? ` — ${detail}` : ''}`);
  }
}

function eq(actual, expected, description) {
  check(JSON.stringify(actual) === JSON.stringify(expected), description,
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
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

async function startServer(timeControl) {
  const child = spawn(SERVER_BIN, [String(PORT), 'web', timeControl], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.on('data', (d) => {
    const text = String(d);
    if (!text.includes('JAVA_TOOL_OPTIONS')) process.stderr.write(`[server] ${text}`);
  });
  await waitForPort(PORT);
  return child;
}

/** Plays a move by tapping the two squares, the way a player does. */
async function tap(page, from, to) {
  await page.click(`#board rect[data-square="${from}"]`);
  await page.click(`#board rect[data-square="${to}"]`);
}

/**
 * Reads the move list as "1. e4 e5 2. Bc4 …". The spans carry no whitespace between them, so
 * textContent alone would run the moves together.
 */
async function moveList(page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('#movesList li')];
    const empty = document.querySelector('#movesList .moves-empty');
    if (empty) return empty.textContent.trim();
    return rows
      .map((li) => [...li.children].map((n) => n.textContent.trim()).filter(Boolean).join(' '))
      .join(' ')
      .trim();
  });
}

const errors = [];

async function newPhone(browser, device, label) {
  const context = await browser.newContext({ ...device });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`[${label}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[${label}] console: ${m.text()}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`[${label}] http ${r.status()}: ${r.url()}`);
  });
  return { context, page };
}

async function join(page, name, color) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.fill('#nameInput', name);
  if (color) await page.selectOption('#colorSelect', color);
  await page.click('#joinBtn');
  await page.waitForSelector('#board .board');
  // The board SVG exists before the first state message arrives. Wait for a rendered seat, or
  // assertions race the network and read empty placeholders.
  await page.waitForFunction(
    () => document.getElementById('bottomColor').textContent.trim() !== '',
    null, { timeout: 5000 },
  );
}

// ------------------------------------------------------------------

mkdirSync(SHOTS, { recursive: true });

// 5+3 so the clocks are live and visible in the screenshots.
const server = await startServer('5+3');
const browser = await chromium.launch();

try {
  // ---------------------------------------------------------------- a real game
  console.log('\ntwo phones, a full game to checkmate');

  const iphone = await newPhone(browser, devices['iPhone 13'], 'iPhone');
  const android = await newPhone(browser, devices['Pixel 5'], 'Android');

  await join(android.page, 'Ana', 'w');
  await join(iphone.page, 'Bo', 'b');

  await android.page.waitForFunction(
    () => document.getElementById('status').textContent.includes('Your move'),
    null, { timeout: 5000 },
  );
  check(true, 'white is told it is their move once both have joined');

  const bottomOnIphone = await iphone.page.textContent('#bottomColor');
  eq(bottomOnIphone, 'Black', 'the iPhone sees its own colour at the bottom (board flipped)');
  const opponentName = await iphone.page.textContent('#topName');
  eq(opponentName, 'Ana', 'and sees the opponent by name');

  // 1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7#
  const line = [
    ['w', 'e2', 'e4'], ['b', 'e7', 'e5'],
    ['w', 'f1', 'c4'], ['b', 'b8', 'c6'],
    ['w', 'd1', 'h5'], ['b', 'g8', 'f6'],
    ['w', 'h5', 'f7'],
  ];

  const sanCount = (ply) => {
    const items = document.querySelectorAll('#movesList li .san');
    let count = 0;
    items.forEach((n) => { if (n.textContent.trim()) count++; });
    return count >= ply;
  };

  for (let i = 0; i < line.length; i++) {
    const [side, from, to] = line[i];
    const mover = side === 'w' ? android.page : iphone.page;
    const waiter = side === 'w' ? iphone.page : android.page;

    // Wait until it really is this phone's turn, then let the opponent's move finish
    // animating. cm-chessboard ignores input while a piece is in flight, so tapping too early
    // silently drops the move — a real player waits for the board to settle too.
    await mover.waitForFunction(
      () => document.getElementById('status').textContent.includes('Your move'),
      null, { timeout: 5000 },
    );
    await sleep(300);

    await tap(mover, from, to);
    // The opponent's board must catch up before the next move is played.
    await waiter.waitForFunction(sanCount, i + 1, { timeout: 5000 });
  }

  const whiteMoves = await moveList(android.page);
  const blackMoves = await moveList(iphone.page);
  eq(whiteMoves, '1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7#',
    'the move list is correct, in algebraic notation');
  eq(blackMoves, whiteMoves, 'and both phones show exactly the same list');

  // The server cannot see mate; a client detects it with chess.js and reports it.
  await android.page.waitForSelector('#sheet:not(.hidden)', { timeout: 5000 });
  const sheetText = await android.page.textContent('#sheetBody');
  check(sheetText.includes('checkmate'), 'checkmate is detected and announced',
    `sheet said: ${sheetText}`);

  await iphone.page.waitForSelector('#sheet:not(.hidden)', { timeout: 5000 });
  const blackSheet = await iphone.page.textContent('#sheetBody');
  check(blackSheet.includes('checkmate'), 'and announced on the other phone too',
    `sheet said: ${blackSheet}`);

  // Screenshots for review: the sheet is dismissed so the board is visible.
  await android.page.click('#sheet .btn:not(.btn-primary)');
  await iphone.page.click('#sheet .btn:not(.btn-primary)');
  await android.page.screenshot({ path: `${SHOTS}/android-white.png`, fullPage: true });
  await iphone.page.screenshot({ path: `${SHOTS}/iphone-black.png`, fullPage: true });
  console.log(`  screenshots written to ${SHOTS}/`);

  // ---------------------------------------------------------------- takeback
  console.log('\ntakeback between two phones');

  await android.page.click('#newGameBtn');
  // Colours swap on a rematch, so Ana is black now and Bo opens.
  await iphone.page.waitForFunction(
    () => document.getElementById('status').textContent.includes('Your move'),
    null, { timeout: 5000 },
  );
  check(true, 'a rematch starts and the colours swap');

  await tap(iphone.page, 'd2', 'd4');
  await android.page.waitForFunction(
    () => document.getElementById('movesList').textContent.includes('d4'),
    null, { timeout: 5000 },
  );

  // Bo regrets it and asks for the move back.
  await iphone.page.click('#takebackBtn');
  await android.page.waitForSelector('#offerBar:not(.hidden)', { timeout: 5000 });
  const offerText = await android.page.textContent('#offerText');
  check(offerText.includes('take back'), 'the opponent is asked to approve the takeback',
    `offer said: ${offerText}`);

  await android.page.click('#offerAccept');
  // Both phones must rewind, so wait on each rather than assuming they land together.
  for (const page of [iphone.page, android.page]) {
    await page.waitForFunction(
      () => document.getElementById('movesList').textContent.includes('No moves yet'),
      null, { timeout: 5000 },
    );
  }
  check(true, 'accepting the takeback rewinds the board on both phones');
  eq(await moveList(android.page), 'No moves yet', 'and the move list is cleared');
  eq(await moveList(iphone.page), 'No moves yet', 'on both of them');

  await iphone.context.close();
  await android.context.close();

  // ---------------------------------------------------------------- promotion
  console.log('\npromotion (pass-and-play, which needs no second phone)');

  const solo = await newPhone(browser, devices['iPhone 13'], 'solo');
  await solo.page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await solo.page.click('#localBtn');
  await solo.page.waitForSelector('#board .board');

  // 1. e4 d5 2. exd5 c6 3. dxc6 Qa5 4. cxb7 Qb6 5. bxa8=Q
  const promoLine = [
    ['e2', 'e4'], ['d7', 'd5'],
    ['e4', 'd5'], ['c7', 'c6'],
    ['d5', 'c6'], ['d8', 'a5'],
    ['c6', 'b7'], ['a5', 'b6'],
  ];
  for (const [from, to] of promoLine) {
    await tap(solo.page, from, to);
    await sleep(140);
  }
  eq(await moveList(solo.page), '1. e4 d5 2. exd5 c6 3. dxc6 Qa5 4. cxb7 Qb6',
    'the run-up to the promotion is played');

  // Capture onto the eighth rank: the promotion dialog must appear.
  await tap(solo.page, 'b7', 'a8');
  await solo.page.waitForSelector('#board rect[data-piece="wq"]', { timeout: 5000 });
  check(true, 'promoting opens the piece chooser');
  await solo.page.screenshot({ path: `${SHOTS}/promotion-dialog.png` });

  // Deliberately choose a knight, not the default queen, to prove the choice is honoured.
  await solo.page.click('#board rect[data-piece="wn"]');
  await solo.page.waitForFunction(
    () => document.getElementById('movesList').textContent.includes('=N'),
    null, { timeout: 5000 },
  );
  const promoted = await moveList(solo.page);
  check(promoted.includes('bxa8=N'), 'the chosen piece is what gets promoted to',
    `move list: ${promoted}`);

  await solo.context.close();
} finally {
  await browser.close();
  server.kill();
}

for (const problem of errors) console.log(`  FAIL ${problem}`);
failures += errors.length;
checks += errors.length;

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} FAILED`);
  process.exit(1);
}
