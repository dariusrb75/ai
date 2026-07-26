# Vendored dependencies

These libraries are committed into the repo **on purpose**. The whole point of this app is that
it runs with no internet connection, so there must be no package manager, no CDN, and no network
fetch at runtime. Everything the browser loads is served from the Android host's APK assets.

Do not replace these with CDN `<script src="https://…">` tags. That would break the app in
exactly the situation it was built for.

| Library | Version | Source | License |
| --- | --- | --- | --- |
| chess.js | 1.4.0 | `npm pack chess.js` → `dist/esm/chess.js` | MIT (`chess.js.LICENSE`) |
| cm-chessboard | 8.12.19 | `npm pack cm-chessboard` → `src/` + `assets/` | MIT (`cm-chessboard/LICENSE`) |

## What each one does

- **chess.js** — the rules engine. Move legality, castling, en passant, promotion, check,
  checkmate, stalemate, threefold repetition, the fifty-move rule, insufficient material, and SAN
  generation. This runs identically on both phones and is the only chess implementation in the
  project; the Kotlin server deliberately knows nothing about chess.
- **cm-chessboard** — board rendering and touch input. Ships as plain ES modules, so it is used
  directly with no build step.

## Piece graphics licensing — read before swapping the sprite

`assets/pieces/standard.svg` is used, **not** `staunty.svg`. The upstream package ships both:

- `standard.svg` — Wikimedia Commons "Standard" pieces, **CC BY-SA 3.0**. Attribution required.
- `staunty.svg` — the lila Staunty set, **CC BY-NC-SA 4.0**. The *NonCommercial* clause makes it
  the wrong default for a repo anyone might reuse, so it is not vendored here.

Attribution for the pieces is shown in the app's About panel and is retained in the SVG's own
header comment. If you swap in `staunty.svg`, you take on the NonCommercial restriction.

## Pruned files

To keep the vendored tree honest, only what the app actually loads was copied. Removed from
upstream `src/extensions/`: `accessibility`, `arrows`, `persistence`, `right-click-annotator`,
`html-layer`, `auto-border-none`. Kept: `markers` (legal-move dots, last-move and check
highlights) and `promotion-dialog`. Source maps, `.scss` sources, and `.sketch` files were also
left out. The remaining imports were verified to have no dangling references.

## Re-vendoring

```sh
npm pack chess.js cm-chessboard
# extract, then copy dist/esm/chess.js and cm-chessboard src/ + the assets listed above
```
