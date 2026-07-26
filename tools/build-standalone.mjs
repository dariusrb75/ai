/**
 * Builds dist/chess-standalone.html: one file containing the whole game.
 *
 * Why this exists: sideloading an APK onto someone else's phone kept failing with
 * "App not installed", which is impossible to debug remotely. A single HTML file removes the
 * install, the server, and the network from the critical path entirely — it opens in any
 * browser, from local storage, with no connection of any kind.
 *
 * Run: node tools/build-standalone.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const TEMPLATE = join(root, 'web/standalone/template.html');
const CHESS_JS = join(root, 'web/vendor/chess.js');
const SPRITE = join(root, 'web/vendor/cm-chessboard/assets/pieces/standard.svg');
const OUT = join(root, 'dist/chess-standalone.html');
// The Artifact host wraps whatever it is given in its own <!doctype>/<head>/<body>, so the
// published variant must be content only — no document scaffolding of its own.
const OUT_ARTIFACT = join(root, 'dist/chess-artifact.html');

/**
 * chess.js ships as an ES module. Inlined into a classic <script> its trailing `export {...}`
 * would be a syntax error, and the sourceMappingURL would point at a file that isn't there.
 */
function inlineChessJs() {
  const source = readFileSync(CHESS_JS, 'utf8');

  const withoutExport = source.replace(/^export\s*\{[^}]*\};?\s*$/gm, '');
  const withoutSourceMap = withoutExport.replace(/^\/\/#\s*sourceMappingURL=.*$/gm, '');

  if (withoutExport === source) {
    throw new Error('chess.js: no export statement was removed — check the vendored file');
  }
  if (/^\s*(import|export)\s/m.test(withoutSourceMap)) {
    throw new Error('chess.js: a module statement survived; it would break a classic <script>');
  }
  if (!/class Chess\b/.test(withoutSourceMap)) {
    throw new Error('chess.js: the Chess class is missing from the inlined source');
  }
  return withoutSourceMap.trim();
}

/**
 * Pulls the piece groups out of the sprite so they can live in an inline <defs>. Each <g id="wp">
 * carries its own centring transform inside a 0..40 box, so <use href="#wp"> renders correctly
 * with no extra positioning.
 */
function inlinePieces() {
  const source = readFileSync(SPRITE, 'utf8');

  const body = source.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim();
  if (!body) throw new Error('sprite: could not extract the SVG body');

  for (const color of ['w', 'b']) {
    for (const type of ['k', 'q', 'r', 'b', 'n', 'p']) {
      if (!body.includes(`id="${color}${type}"`)) {
        throw new Error(`sprite: piece ${color}${type} is missing`);
      }
    }
  }
  if (/(xlink:)?href="(https?:)?\/\//.test(body)) {
    throw new Error('sprite: contains an external reference, which would need the network');
  }
  return body;
}

const template = readFileSync(TEMPLATE, 'utf8');
if (!template.includes('/*__CHESS_JS__*/')) throw new Error('template: missing chess.js marker');
if (!template.includes('<!--__PIECES__-->')) throw new Error('template: missing pieces marker');

const html = template
  .replace('/*__CHESS_JS__*/', inlineChessJs())
  .replace('<!--__PIECES__-->', inlinePieces());

// Nothing may reach out to the network. This is the guarantee the whole file exists for.
const remoteRef = html.match(/(?:src|href)\s*=\s*["'](?!#|data:)(?:https?:)?\/\/[^"']*/i);
if (remoteRef) throw new Error(`built file references a remote URL: ${remoteRef[0]}`);
for (const banned of ['fetch(', 'XMLHttpRequest', 'importScripts', 'WebSocket']) {
  if (html.includes(banned)) throw new Error(`built file contains ${banned}, which implies network use`);
}

/**
 * Strips the document scaffolding, keeping the <style> block and everything inside <body>.
 * Both variants come from the same template so the two can never diverge.
 */
function toArtifactFragment(fullDocument) {
  const style = fullDocument.match(/<style>[\s\S]*?<\/style>/);
  if (!style) throw new Error('artifact: could not find the <style> block');

  const body = fullDocument.match(/<body>([\s\S]*)<\/body>/);
  if (!body) throw new Error('artifact: could not find the <body> contents');

  const fragment = `${style[0]}\n${body[1].trim()}\n`;
  if (/<!DOCTYPE|<html|<head|<body/i.test(fragment)) {
    throw new Error('artifact: document scaffolding survived the strip');
  }
  return fragment;
}

const kb = (bytes) => (bytes / 1024).toFixed(0);

mkdirSync(join(root, 'dist'), { recursive: true });

writeFileSync(OUT, html);
console.log(`wrote ${OUT}`);
console.log(`  ${kb(Buffer.byteLength(html))} KB, single file, no external references`);

const fragment = toArtifactFragment(html);
writeFileSync(OUT_ARTIFACT, fragment);
console.log(`wrote ${OUT_ARTIFACT}`);
console.log(`  ${kb(Buffer.byteLength(fragment))} KB, body-only variant for publishing`);
