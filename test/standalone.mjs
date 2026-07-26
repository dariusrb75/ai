/**
 * Tests dist/chess-standalone.html the way it will actually be used: opened as a local file,
 * with no server anywhere.
 *
 * The most important assertion here is the last one — that the page issues **zero** network
 * requests. That is the whole promise of this file.
 */

import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE_URL = 'file://' + join(root, 'dist/chess-standalone.html');
const SHOTS = join(root, 'test/screenshots');

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

mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const problems = [];
const remoteRequests = [];

async function openPage() {
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  // "New game" asks for confirmation once moves have been played. Playwright dismisses dialogs
  // by default, which would silently cancel it and make every later assertion nonsense.
  page.on('dialog', (dialog) => dialog.accept());
  // The entire point of this file: nothing may leave the device.
  page.on('request', (req) => {
    if (/^https?:/i.test(req.url())) remoteRequests.push(req.url());
  });
  await page.goto(FILE_URL, { waitUntil: 'domcontentloaded' });
  return { context, page };
}

const squares = (page) => page.locator('#board .sq');
const tap = async (page, from, to) => {
  await page.click(`#board .sq[data-square="${from}"]`);
  await page.click(`#board .sq[data-square="${to}"]`);
};
const moveList = (page) => page.evaluate(() => {
  const empty = document.querySelector('#moves .empty');
  if (empty) return empty.textContent.trim();
  return [...document.querySelectorAll('#moves li')]
    .map((li) => [...li.children].map((n) => n.textContent.trim()).filter(Boolean).join(' '))
    .join(' ').trim();
});

try {
  // ---------------------------------------------------------------- loads at all
  console.log('\nopening the file directly, no server');
  let { context, page } = await openPage();

  eq(await page.title(), 'Échecs hors ligne', 'the page loads from file://');
  check(await page.isVisible('#menu'), 'the mode menu is shown first');

  // ---------------------------------------------------------------- pass and play
  console.log('\npass and play on one phone');
  await page.click('#mSame');
  await page.waitForSelector('#board .sq');

  eq(await squares(page).count(), 64, 'the board has 64 squares');
  eq(await page.locator('#board .sq svg').count(), 32, 'and 32 pieces are drawn');
  check((await page.textContent('#status')).includes('blancs'), 'white is to move');
  eq(await moveList(page), 'Aucun coup', 'the move list starts empty');

  // 1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7#
  const mate = [['e2', 'e4'], ['e7', 'e5'], ['f1', 'c4'], ['b8', 'c6'],
    ['d1', 'h5'], ['g8', 'f6'], ['h5', 'f7']];
  for (const [from, to] of mate) {
    await tap(page, from, to);
    await sleep(60);
  }

  eq(await moveList(page), '1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7#',
    'a full game plays through by tapping squares');
  const finalStatus = await page.textContent('#status');
  check(finalStatus.includes('échec et mat') && finalStatus.includes('blancs gagnent'),
    'checkmate is detected and announced', `status: ${finalStatus}`);
  check(await page.locator('#board .sq.check').count() === 1,
    'the mated king is highlighted');
  check(await page.locator('#board .sq.last').count() === 2,
    'the last move is highlighted on both its squares');

  await page.screenshot({ path: join(SHOTS, 'standalone-mate.png'), fullPage: true });

  // Legal-move dots and selection.
  await page.click('#newg');
  await page.click('#board .sq[data-square="e2"]');
  eq(await page.locator('#board .sq .dot').count(), 2, 'selecting a pawn shows its two moves');
  check(await page.locator('#board .sq.sel').count() === 1, 'and the square is marked selected');
  await page.click('#board .sq[data-square="e2"]');
  eq(await page.locator('#board .sq .dot').count(), 0, 'tapping it again deselects');

  // Castling, en passant support via the rules engine.
  for (const [from, to] of [['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3'], ['b8', 'c6'],
    ['f1', 'c4'], ['g8', 'f6'], ['e1', 'g1']]) {
    await tap(page, from, to);
    await sleep(60);
  }
  check((await moveList(page)).includes('O-O'), 'castling works',
    `moves: ${await moveList(page)}`);

  // Undo.
  await page.click('#undo');
  await sleep(80);
  check(!(await moveList(page)).includes('O-O'), 'undo takes the last move back');

  // ---------------------------------------------------------------- promotion
  console.log('\npromotion');
  await page.click('#newg');
  await sleep(80);
  // 1. e4 d5 2. exd5 c6 3. dxc6 Qa5 4. cxb7 Qb6 5. bxa8=?
  for (const [from, to] of [['e2', 'e4'], ['d7', 'd5'], ['e4', 'd5'], ['c7', 'c6'],
    ['d5', 'c6'], ['d8', 'a5'], ['c6', 'b7'], ['a5', 'b6']]) {
    await tap(page, from, to);
    await sleep(60);
  }
  await tap(page, 'b7', 'a8');
  await page.waitForSelector('#promo:not(.hidden)', { timeout: 3000 });
  check(true, 'reaching the last rank opens the promotion chooser');
  eq(await page.locator('#promoOpts button').count(), 4, 'with four pieces to choose from');
  await page.screenshot({ path: join(SHOTS, 'standalone-promotion.png') });

  // Deliberately not the queen, to prove the choice is honoured.
  await page.click('#promoOpts button[data-piece="n"]');
  await sleep(120);
  check((await moveList(page)).includes('bxa8=N'), 'the chosen piece is what appears',
    `moves: ${await moveList(page)}`);
  check(await page.isHidden('#promo'), 'and the chooser closes');

  await context.close();

  // ---------------------------------------------------------------- two phones
  console.log('\ntwo phones, moves dictated aloud');
  ({ context, page } = await openPage());
  await page.click('#mTwo');
  await page.click('#pickW');
  await page.waitForSelector('#board .sq');

  eq(await page.textContent('#botTag'), 'vous', 'your own side is at the bottom');
  check(await page.isHidden('#entry'), 'no entry box while it is your turn');

  await tap(page, 'e2', 'e4');
  await sleep(120);
  check(await page.isVisible('#say'), 'after your move you are told what to announce');
  eq(await page.textContent('#sayMove'), 'e4', 'and it shows the move in notation');
  check(await page.isVisible('#entry'), 'and the box to enter their reply appears');

  // A move the opponent could not have played must be refused, not silently swallowed.
  await page.fill('#oppInput', 'e5e6');
  await page.click('#oppOk');
  await sleep(80);
  check((await page.textContent('#oppErr')).includes('impossible'),
    'an impossible move is refused with a message',
    `error shown: ${await page.textContent('#oppErr')}`);
  eq(await moveList(page), '1. e4', 'and the game is untouched');

  // Plain notation.
  await page.fill('#oppInput', 'e5');
  await page.click('#oppOk');
  await sleep(120);
  eq(await moveList(page), '1. e4 e5', "the opponent's move is accepted");
  eq(await page.textContent('#oppErr'), '', 'and the error clears');
  check(await page.isHidden('#say'), 'the announce banner goes away once they have replied');

  // French piece letters: "Cf3" is a knight to f3.
  await tap(page, 'g1', 'f3');
  await sleep(120);
  eq(await page.textContent('#sayMove'), 'Nf3', 'your knight move is shown to read out');
  await page.fill('#oppInput', 'Cc6');
  await page.click('#oppOk');
  await sleep(120);
  check((await moveList(page)).includes('Nc6'),
    'French notation is understood — "Cc6" becomes a knight move',
    `moves: ${await moveList(page)}`);

  // Two-square form.
  await tap(page, 'f1', 'c4');
  await sleep(120);
  await page.fill('#oppInput', 'g8f6');
  await page.click('#oppOk');
  await sleep(120);
  check((await moveList(page)).includes('Nf6'),
    'the two-square form works too — "g8f6"',
    `moves: ${await moveList(page)}`);

  await page.screenshot({ path: join(SHOTS, 'standalone-two-phones.png'), fullPage: true });

  // The board must be kept from the black player's own side on their phone.
  await context.close();
  ({ context, page } = await openPage());
  await page.click('#mTwo');
  await page.click('#pickB');
  await page.waitForSelector('#board .sq');
  eq(await page.textContent('#botWho'), 'Noirs', 'playing black puts black at the bottom');
  check(await page.isVisible('#entry'), 'and black is asked for white\'s opening move first');
  await context.close();
} finally {
  await browser.close();
}

// ---------------------------------------------------------------- the core promise
console.log('\nno network at all');
eq(remoteRequests, [], 'the page made zero http/https requests');

for (const problem of problems) {
  failures++;
  checks++;
  console.log(`  FAIL ${problem}`);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} FAILED`);
  process.exit(1);
}
