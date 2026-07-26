package dev.offlinechess.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import dev.offlinechess.core.AssetSource
import dev.offlinechess.core.ChessServer
import dev.offlinechess.core.FileGameStore
import dev.offlinechess.core.TimeControl
import java.io.File
import java.io.InputStream

/**
 * Runs the game server for as long as the game lasts.
 *
 * A foreground service is not decoration here: it is the only way Android will let a socket
 * keep accepting connections while the screen is off and the app is in the background. Without
 * it, the host phone going to sleep would drop the guest mid-game — which outdoors is the normal
 * course of events, not an edge case.
 */
class ChessHostService : Service() {

    private var server: ChessServer? = null
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }

        val timeControl = TimeControl.parse(intent?.getStringExtra(EXTRA_TIME_CONTROL))
        val newGame = intent?.getBooleanExtra(EXTRA_NEW_GAME, false) ?: false

        startForeground(NOTIFICATION_ID, buildNotification())
        acquireWakeLock()
        startServer(timeControl, newGame)

        // START_STICKY: if Android kills us for memory, come back. The saved game file means
        // the restarted service resumes the same game rather than starting a new one.
        return START_STICKY
    }

    private fun startServer(timeControl: TimeControl, newGame: Boolean) {
        if (server != null) return

        val store = FileGameStore(File(filesDir, "game.json"))
        if (newGame) store.clear()

        val instance = ChessServer(
            port = PORT,
            assets = ApkAssetSource(this),
            store = store,
            timeControl = timeControl,
        )
        if (!newGame) instance.restoreFromStore()

        try {
            instance.start()
            server = instance
            isRunning = true
        } catch (e: Exception) {
            // Almost always "port already in use" from a previous instance that has not died
            // yet. Surface it rather than sitting there looking started.
            lastError = e.message ?: "could not start the server"
            isRunning = false
            stopSelf()
        }
    }

    /**
     * A partial wake lock keeps the CPU available so the socket and the clocks keep running with
     * the screen off. It does not keep the screen on — MainActivity handles that separately for
     * as long as someone is actually looking at the board.
     */
    private fun acquireWakeLock() {
        if (wakeLock != null) return
        val power = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "offline-chess:host").apply {
            setReferenceCounted(false)
            acquire(MAX_GAME_MILLIS)
        }
    }

    override fun onDestroy() {
        server?.stop()
        server = null
        isRunning = false
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
        super.onDestroy()
    }

    private fun buildNotification(): Notification {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                getString(R.string.channel_name),
                // Low: an ongoing status notification should never make a sound.
                NotificationManager.IMPORTANCE_LOW,
            ).apply { description = getString(R.string.channel_description) }
            manager.createNotificationChannel(channel)
        }

        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val stop = PendingIntent.getService(
            this,
            1,
            Intent(this, ChessHostService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val address = HostInfo.best()
        val text = if (address != null) {
            getString(R.string.notification_hosting_at, address.url(PORT))
        } else {
            getString(R.string.notification_hosting)
        }

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }

        return builder
            .setContentTitle(getString(R.string.notification_title))
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentIntent(open)
            .setOngoing(true)
            .addAction(
                Notification.Action.Builder(null, getString(R.string.notification_stop), stop)
                    .build()
            )
            .build()
    }

    companion object {
        const val PORT = 8080
        const val EXTRA_TIME_CONTROL = "time_control"
        const val EXTRA_NEW_GAME = "new_game"
        const val ACTION_STOP = "dev.offlinechess.app.STOP"

        private const val CHANNEL_ID = "chess_host"
        private const val NOTIFICATION_ID = 1

        /** Wake locks must be bounded; twelve hours outlasts any plausible game. */
        private const val MAX_GAME_MILLIS = 12L * 60 * 60 * 1000

        /** Read by MainActivity to show whether hosting actually came up. */
        @Volatile
        var isRunning: Boolean = false
            private set

        @Volatile
        var lastError: String? = null
            private set

        fun start(context: Context, timeControl: String?, newGame: Boolean) {
            lastError = null
            val intent = Intent(context, ChessHostService::class.java)
                .putExtra(EXTRA_TIME_CONTROL, timeControl)
                .putExtra(EXTRA_NEW_GAME, newGame)
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, ChessHostService::class.java))
        }
    }
}

/** Serves the web client out of the APK's assets. */
private class ApkAssetSource(context: Context) : AssetSource {
    private val assets = context.assets

    override fun open(path: String): InputStream? = try {
        assets.open(path)
    } catch (e: Exception) {
        null
    }

    /**
     * AssetManager has no exists(); opening is the only reliable check. `list()` is no good
     * because it does not see files inside compressed asset directories consistently.
     */
    override fun exists(path: String): Boolean {
        val stream = open(path) ?: return false
        return try {
            stream.close()
            true
        } catch (e: Exception) {
            true
        }
    }
}
