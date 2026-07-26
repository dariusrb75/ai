# Field guide

Read this once before you leave. It is short, and every item in it is here because it will
otherwise bite you somewhere with no signal.

## The one thing that matters most

**Do a full rehearsal at home, while you still have internet.** Install the app, turn the
hotspot on, join from the iPhone, and play five or six real moves. If something is wrong, you
want to find out while a fix is still possible — not at the campsite.

---

## Before you leave (needs internet)

1. **Install the APK on the Android phone.**
   Copy `dist/offline-chess.apk` to the phone and tap it, choosing the system
   **Package installer**. Android will ask you to allow installing unknown apps for whichever
   app you opened it from (Files, Chrome, Drive) — that permission is per-app, so allow it for
   that one and tap Install again. Play Protect may also warn: **More details** →
   **Install anyway**. Both prompts are normal for anything outside the Play Store.

   **If it says "App not installed":** work through these in order.
   - **Uninstall any previous attempt.** A leftover package with the same app ID but a different
     signature fails with this exact message, which makes a perfectly good file look broken.
   - **Check the file size** in a file manager. It must be exactly **3,004,192 bytes** (2.9 MB).
     Anything else means the download was truncated — re-send it, as a *document* rather than a
     photo or a cloud link.
   - **Check the Android version** (Settings → About phone). The app needs **Android 8.0** or
     newer.
   - Make sure you are using the system **Package installer**, not a cloud app like TeraBox,
     which only uploads the file instead of installing it.

2. **Turn off Wi-Fi Assist on the iPhone.**
   Settings → Cellular → scroll to the bottom → **Wi-Fi Assist off**.
   Leave this on and iOS will quietly abandon an internet-less hotspot for cellular in the
   middle of a game. This is the single most likely cause of a mid-game disconnect.

3. **Set the Android hotspot's auto-off timer to never.**
   Settings → Network & internet → Hotspot & tethering → Wi-Fi hotspot → Advanced.
   Samsung, Xiaomi and others switch an "idle" hotspot off after a few minutes.

4. **Turn battery saver off on both phones**, and exempt the chess app from battery
   optimisation if your Android offers it (Settings → Apps → Offline Chess → Battery →
   Unrestricted). Aggressive power management is the most common cause of a dropped socket.

5. **Rehearse.** Steps below, start to finish, with real moves.

6. **Add it to the iPhone's Home Screen.** In Safari, tap Share → Add to Home Screen. It then
   opens fullscreen with no browser bars. The host must be running when you launch it.

---

## In the field

**On the Android phone:**
1. Turn on the Wi-Fi hotspot. Mobile data can stay off — you do not need a SIM, a signal, or
   any internet for this.
2. Open **Offline Chess**. Enter your name, choose your colour and a clock, tap **Start hosting**.
3. A QR code and an address appear.
4. Tap **Open the board** when you want to play. (The game keeps running if you switch away.)

**On the iPhone:**
1. Settings → Wi-Fi → join the Android phone's hotspot.
2. iOS will warn **"No Internet Connection"**. That is expected and correct — dismiss it and
   stay connected.
3. Point the Camera app at the QR code and tap the link. Or open Safari and type the address
   shown on the Android screen.
4. Enter your name and tap **Join the game**.

That's it. The board is live on both phones.

---

## While playing

- **Whose turn it is**: that player's name bar gets a green edge, and their clock turns green.
- **A phone that locks or sleeps** rejoins its own game automatically when you wake it. It does
  not forfeit, and the clock of whoever is *to move* pauses while their phone is away, shown
  struck through. You cannot lose a game to a phone in a pocket.
- **Takeback** asks the opponent to approve, and rewinds to your own move — one ply if you just
  moved, two if they already replied. Your clock is restored too, not just the position.
  It also works after checkmate, if someone wants a blunder back.
- **New game** swaps colours and keeps the same clock.
- **A third device** that joins the hotspot and opens the address can watch, but not move.

## If something goes wrong

| What you see | What to do |
| --- | --- |
| iPhone can't load the page | Confirm it is on the hotspot (Settings → Wi-Fi, ticked). Then check the address on the Android screen matches what you typed — if the hotspot was toggled, the IP can change. |
| "Reconnecting…" that doesn't clear | The Android app has stopped or the hotspot dropped. Reopen the app; the game is saved and resumes where it was. |
| Address shows "No network address found" | The hotspot is off. Turn it on; the screen refreshes when you come back to the app. |
| It all went wrong and you just want to play | Tap **Pass & play on this phone** on the join screen. One phone, two players, no connection of any kind. The game is right there. |

## Why there is no Bluetooth option

Bluetooth between Android and iPhone is not possible for this. Classic Bluetooth serial does
not exist on iOS at all, and the BLE route needs a real installed iOS app — which needs a Mac,
Xcode, and an Apple signing profile that expires after seven days. Wi-Fi via the hotspot needs
none of that and the iPhone installs nothing.

## Why the iPhone needs the Android phone running

The page is served over plain HTTP on a private address, and Safari only allows offline caching
(service workers) over HTTPS. There is no certificate authority out in the woods, and a
self-signed certificate would make Safari refuse the page outright. So the iPhone cannot keep
its own copy of the app — the Android host has to be on.

That is exactly why **pass & play** exists. If the hosting side is ever the problem, you can
still play.
