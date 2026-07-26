# Test harness

These tests need Node and Playwright, which are **development-only** dependencies. Nothing here
ships to the phones, and the app itself never touches the network at runtime.

```sh
../gradlew :core:test          # engine unit tests (clocks, takeback, seats, persistence)
../gradlew :tools:installDist  # required by the two harnesses below

node smoke.mjs      # loads the client in a browser, fails on any console/page/HTTP error
node protocol.mjs   # two simulated phones over real WebSockets against the real server
node e2e.mjs        # two browser contexts playing real games through the actual UI
```

`e2e.mjs` writes screenshots to `screenshots/` (gitignored).

## What these cannot cover

Only Chromium is available in this container, so the iPhone is emulated by viewport and user
agent. That verifies layout and logic, **not** real iOS Safari, a real Android hotspot, or real
phone-to-phone Wi-Fi. Those need the rehearsal described in `../docs/FIELD-GUIDE.md`.
