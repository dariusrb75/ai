/**
 * Loads the client in a real browser and fails on any console error, page error, or failed
 * request. Catches broken ES module paths and typos that a linter would not.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080';

const browser = await chromium.launch();
const page = await browser.newPage();

const problems = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') problems.push(`console.error: ${msg.text()}`);
});
page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
page.on('requestfailed', (req) =>
  problems.push(`requestfailed: ${req.url()} ${req.failure()?.errorText}`));
page.on('response', (res) => {
  if (res.status() >= 400) problems.push(`http ${res.status()}: ${res.url()}`);
});

await page.goto(BASE, { waitUntil: 'networkidle' });

// Pass-and-play needs no server state, so it is the quickest way to prove the board,
// the rules engine and the render pipeline all loaded and work.
await page.click('#localBtn');
await page.waitForSelector('#board .board', { timeout: 5000 });

const pieceCount = await page.locator('#board .pieces-layer use, #board .pieces g use').count();
console.log(`pieces rendered: ${pieceCount}`);
if (pieceCount < 32) problems.push(`expected 32 pieces on the start position, saw ${pieceCount}`);

const status = await page.textContent('#status');
console.log(`status: ${status}`);

// Play a move by clicking the two squares, proving input and the rules engine are wired up.
await page.click('#board rect[data-square="e2"]');
await page.click('#board rect[data-square="e4"]');
await page.waitForTimeout(400);

const moves = await page.textContent('#movesList');
console.log(`moves after e4: ${moves.trim()}`);
if (!moves.includes('e4')) problems.push(`e4 did not reach the move list, got: ${moves.trim()}`);

await browser.close();

if (problems.length) {
  console.error('\nFAILED:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('\nsmoke test passed');
