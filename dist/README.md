# dist

`offline-chess.apk` — install this on the **Android** phone. The iPhone installs nothing.

Debug-signed, so Android will call it an app from an "unknown source": open it from Files or your
browser, allow installing unknown apps for that one app when prompted, then tap Install again.

Rebuild it with `./gradlew :app:assembleDebug` and copy
`app/build/outputs/apk/debug/app-debug.apk` here.

A binary normally has no business in a repo. It is tracked here on purpose: the whole point is
that it must be downloadable onto a phone *before* leaving for somewhere with no signal.

See [../docs/FIELD-GUIDE.md](../docs/FIELD-GUIDE.md) for setup.
