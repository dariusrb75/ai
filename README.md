# Offline Chess

1v1 chess between an **Android phone and an iPhone with no internet, no router, and no accounts**.
The Android phone turns on its Wi-Fi hotspot and hosts the game; the iPhone joins that hotspot and
plays in Safari. Nothing installs on the iPhone, and no traffic ever leaves the two phones.

Built for two people going camping.

**→ [docs/FIELD-GUIDE.md](docs/FIELD-GUIDE.md) is the one you actually need before a trip.**

## How it works

```
Android phone (HOST)                              iPhone (GUEST)
┌────────────────────────────────────┐
│ ChessHostService (foreground)      │            ┌──────────────────────┐
│   HTTP + WebSocket on :8080        │◄── Wi-Fi ──│ Safari               │
│   bound to 0.0.0.0                 │  hotspot,  │ http://192.168.x.x   │
│   ├─ GET /   → the web client      │ no internet│   :8080              │
│   └─ WS /ws  → the game protocol   │            └──────────────────────┘
│                                    │
│ GameSession (authoritative)        │      Both phones run the same client.
│   move log · clocks · seats        │      The host reaches it on 127.0.0.1,
│   persisted to disk each move      │      the guest over the hotspot.
│                                    │
│ MainActivity → WebView 127.0.0.1   │
│   + join QR code and addresses     │
└────────────────────────────────────┘
```

### The server does not know the rules of chess

It owns the move log, the clocks and the seats. Legality, checkmate, stalemate, repetition and
SAN all live in `chess.js` on the client. Two consequences, both deliberate:

- There is exactly **one** rules implementation, so the two phones cannot disagree about whether
  a move was legal. A second engine in Kotlin would only be a second thing to get wrong.
- Whose clock runs is derived from the *number* of moves played, which needs no chess knowledge.

Cheat resistance is irrelevant here: both players are sitting on the same log.

### Built to survive a field with no support

- **Disconnecting never forfeits.** Phones sleep in pockets and iOS drops sockets when Safari
  backgrounds. The clock of the player *to move* pauses while their phone is away, and the UI
  strikes it through so a paused clock is never misread as a running one.
- **Seats are reclaimed by token**, so a phone that locked or fell off the hotspot rejoins its
  own game instead of losing it.
- **Every move carries the client's expected ply**, and a mismatch is refused — a resend over a
  flaky link cannot be applied twice.
- **The game is saved after every move**, so force-killing the app or Android reclaiming it for
  memory resumes the same game.
- **Pass & play on one phone** is built into the same client as a fallback that cannot fail.

## Layout

| Path | What it is |
| --- | --- |
| `core/` | Pure JVM Kotlin: game state, clocks, seats, and the embedded server. **No Android imports** — this is what makes the whole thing testable without an emulator. |
| `app/` | The Android host: foreground service, join screen with QR code, WebView. |
| `web/` | The client both phones run. Vendored `chess.js` + `cm-chessboard` under `web/vendor`. |
| `tools/` | Runs the server headlessly on a desktop JVM, for the test harnesses. |
| `test/` | Browser smoke test, two-phone protocol driver, two-context UI end-to-end. |
| `dist/` | The built APK, ready to sideload. |

Android access to files and storage is confined to two interfaces, `AssetSource` and `GameStore`,
which is the whole reason `core/` stays Android-free.

## Building

Needs a JDK and the Android SDK (`ANDROID_HOME`, or `sdk.dir` in `local.properties`).

```sh
./gradlew :app:assembleDebug     # → app/build/outputs/apk/debug/app-debug.apk
```

Debug-signed on purpose: it sideloads with no keystore to manage. ~3.6 MB, minSdk 26 (Android 8),
targetSdk 35.

## Testing

```sh
./gradlew :core:test             # 33 unit tests: clocks, takeback, seats, persistence
./gradlew :tools:installDist     # needed by the two harnesses below
node test/smoke.mjs              # fails on any console error, page error, or bad HTTP status
node test/protocol.mjs           # 43 checks: two simulated phones over real WebSockets
node test/e2e.mjs                # 15 checks: two browser contexts playing through the real UI
```

Clock tests drive an injected time source rather than sleeping, so they are instant and
deterministic. `protocol.mjs` covers the scenario that actually matters outdoors: a hard
disconnect followed by a reconnect that restores the game.

### What the tests cannot cover

Only Chromium is available in CI, so the iPhone is emulated by viewport and user agent. That
verifies layout and logic but is **not** real iOS Safari, a real Android hotspot, or real
phone-to-phone Wi-Fi. Those need the five-minute rehearsal in the field guide, done while you
still have internet.

## Licences

The app is yours. Vendored dependencies keep their own: `chess.js` (MIT), `cm-chessboard` (MIT),
and the piece graphics from Wikimedia Commons (CC BY-SA 3.0, attributed in the app's About
panel). See [web/vendor/README.md](web/vendor/README.md) — including why the `staunty` piece set
is deliberately *not* used.
