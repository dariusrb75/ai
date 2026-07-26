# dist

`offline-chess.apk` — install this on the **Android** phone. The iPhone installs nothing.

| | |
| --- | --- |
| Size | **3,004,192 bytes** (2.9 MB) |
| MD5 | `60122f49b804b8bff856b266ac72a048` |
| Version | 1.1 (versionCode 2) |
| Requires | Android 8.0 or newer |
| Signed with | v1 (JAR) + v2 + v3, release build, not debuggable |

If a file manager reports a size other than the one above, the download was truncated — that
alone produces "App not installed". Re-send the file before troubleshooting anything else.

## Why it is a release build signed with v1

An earlier debug build failed to install with **"App not installed"**. Two causes, both fixed
here:

- **No v1 signature.** Gradle omits v1 (JAR) signing whenever `minSdk >= 24`, but several OEM
  package installers — MIUI, Oppo, Vivo, older Samsung — still reject a v2-only APK outright.
- **Debuggable.** `assembleDebug` sets `android:debuggable="true"`, which some hardened OEM
  builds refuse to install without extra developer permissions.

So this is `assembleRelease`, signed with all three schemes. Verify any rebuild with:

```sh
apksigner verify --verbose --min-sdk-version 21 dist/offline-chess.apk
```

`--min-sdk-version 21` matters: without it, apksigner scopes verification to the APK's own minSdk
of 26, where v1 is not required, and reports `v1: false` even when a valid v1 signature is there.

## Installing

Open it from Files or your browser and choose the system **Package installer**. Android will say
the app is from an unknown source: allow installing unknown apps for that one app, then tap
Install. Play Protect may also warn — **More details** → **Install anyway**. That is normal for
anything outside the Play Store.

**If it still refuses:** uninstall any previous attempt first. A leftover package with the same
`applicationId` but a different signature fails with this same message.

## Rebuilding

```sh
# One-off: create a signing keystore (gitignored on purpose).
keytool -genkeypair -v -keystore sideload.jks -alias sideload \
  -keyalg RSA -keysize 2048 -validity 10950 \
  -storepass offlinechess -keypass offlinechess \
  -dname "CN=Offline Chess, O=Offline Chess, C=FR"

./gradlew :app:assembleRelease
cp app/build/outputs/apk/release/app-release.apk dist/offline-chess.apk
```

Override the defaults with `-PsideloadKeystore=…`, `-PsideloadPassword=…`, `-PsideloadAlias=…`.
There is no Play Store and no update channel here, so losing the keystore costs nothing: make a
new one, uninstall the old app, reinstall.

A binary normally has no business in a repo. It is tracked here on purpose: the whole point is
that it must be downloadable onto a phone *before* leaving for somewhere with no signal.

See [../docs/FIELD-GUIDE.md](../docs/FIELD-GUIDE.md) for setup.
