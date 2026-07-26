package dev.offlinechess.app

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import java.net.URLEncoder

/**
 * Three screens in one activity: pick your colour and clock, show the join code, then play.
 *
 * The host plays in a WebView pointed at 127.0.0.1 rather than in a native board, so both phones
 * run byte-for-byte the same client. Anything that works on one works on the other.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var setupPanel: ScrollView
    private lateinit var hostPanel: ScrollView
    private lateinit var webView: WebView

    private lateinit var nameInput: EditText
    private lateinit var colorGroup: RadioGroup
    private lateinit var clockGroup: RadioGroup

    private lateinit var qrImage: ImageView
    private lateinit var addressText: TextView
    private lateinit var otherAddresses: TextView

    private var playerName: String = "Host"
    private var playerColor: String = "w"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        setupPanel = findViewById(R.id.setupPanel)
        hostPanel = findViewById(R.id.hostPanel)
        webView = findViewById(R.id.webView)
        nameInput = findViewById(R.id.nameInput)
        colorGroup = findViewById(R.id.colorGroup)
        clockGroup = findViewById(R.id.clockGroup)
        qrImage = findViewById(R.id.qrImage)
        addressText = findViewById(R.id.addressText)
        otherAddresses = findViewById(R.id.otherAddresses)

        findViewById<Button>(R.id.startBtn).setOnClickListener { onStartHosting() }
        findViewById<Button>(R.id.openBoardBtn).setOnClickListener { showBoard() }
        findViewById<Button>(R.id.stopBtn).setOnClickListener { onStopHosting() }

        configureWebView()
        requestNotificationPermissionIfNeeded()

        // Back from the board returns to the join screen instead of leaving the game.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.visibility == View.VISIBLE) {
                    showHostPanel()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })

        // Coming back to an app whose service is already hosting should land on the board,
        // not ask the player to set the game up again.
        if (ChessHostService.isRunning) showHostPanel()
    }

    /**
     * Android 13+ needs this to display the foreground service's notification. The service still
     * runs if it is refused, so this is a request and not a gate.
     */
    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val granted = ContextCompat.checkSelfPermission(
            this, Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
        if (!granted) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
    }

    private fun onStartHosting() {
        playerName = nameInput.text.toString().trim().ifEmpty { "Host" }
        playerColor = if (colorGroup.checkedRadioButtonId == R.id.colorBlack) "b" else "w"

        ChessHostService.start(this, selectedTimeControl(), newGame = true)

        // The server binds on a background thread; give it a moment before reporting status.
        webView.postDelayed({
            val error = ChessHostService.lastError
            if (error != null) {
                Toast.makeText(this, getString(R.string.host_failed, error), Toast.LENGTH_LONG)
                    .show()
                return@postDelayed
            }
            showHostPanel()
        }, 600)
    }

    private fun selectedTimeControl(): String = when (clockGroup.checkedRadioButtonId) {
        R.id.clock5 -> "5+0"
        R.id.clock105 -> "10+5"
        R.id.clock1510 -> "15+10"
        R.id.clock30 -> "30+0"
        else -> "unlimited"
    }

    private fun onStopHosting() {
        ChessHostService.stop(this)
        webView.loadUrl("about:blank")
        setupPanel.visibility = View.VISIBLE
        hostPanel.visibility = View.GONE
        webView.visibility = View.GONE
        clearKeepScreenOn()
    }

    private fun showHostPanel() {
        setupPanel.visibility = View.GONE
        hostPanel.visibility = View.VISIBLE
        webView.visibility = View.GONE
        clearKeepScreenOn()
        renderAddresses()
    }

    private fun renderAddresses() {
        val addresses = HostInfo.addresses()
        val primary = addresses.firstOrNull()

        if (primary == null) {
            addressText.text = getString(R.string.host_no_address)
            qrImage.visibility = View.GONE
            otherAddresses.visibility = View.GONE
            return
        }

        val url = primary.url(ChessHostService.PORT)
        addressText.text = url
        qrImage.visibility = View.VISIBLE
        // 640px is generous for a 260dp view, so the code stays crisp on a high-density screen.
        QrCode.render(url, 640)?.let { qrImage.setImageBitmap(it) }

        // The guest is on the hotspot, but if the two phones happen to share a router instead,
        // the working address may be a different one. Show the rest rather than hide them.
        val rest = addresses.drop(1)
        if (rest.isEmpty()) {
            otherAddresses.visibility = View.GONE
        } else {
            otherAddresses.visibility = View.VISIBLE
            otherAddresses.text = buildString {
                append(getString(R.string.host_other_addresses))
                for (address in rest) {
                    append("\n")
                    append(address.url(ChessHostService.PORT))
                    append("  (")
                    append(address.interfaceName)
                    append(")")
                }
            }
        }
    }

    private fun showBoard() {
        setupPanel.visibility = View.GONE
        hostPanel.visibility = View.GONE
        webView.visibility = View.VISIBLE
        keepScreenOn()

        // Loopback, so the host's own board never depends on the hotspot being up.
        val name = URLEncoder.encode(playerName, "UTF-8")
        webView.loadUrl(
            "http://127.0.0.1:${ChessHostService.PORT}/" +
                "?autojoin=1&name=$name&color=$playerColor"
        )
    }

    private fun configureWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            // localStorage holds the player token that makes reconnect work. Without DOM
            // storage the host would be handed a new seat every time it reloaded.
            domStorageEnabled = true
            // Never consult a cache for the client; the APK is the only source of truth and a
            // stale copy after an update is impossible to clear from inside the app.
            cacheMode = WebSettings.LOAD_NO_CACHE
            mediaPlaybackRequiresUserGesture = true
            // The page is served from this app's own assets over loopback; there is nothing
            // else on the device to reach and no remote content is ever loaded.
            allowFileAccess = false
            allowContentAccess = false
        }
        WebView.setWebContentsDebuggingEnabled(false)
    }

    private fun keepScreenOn() {
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    private fun clearKeepScreenOn() {
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    override fun onResume() {
        super.onResume()
        // Addresses change when the hotspot is toggled, so re-read them rather than showing a
        // stale IP the guest cannot reach.
        if (hostPanel.visibility == View.VISIBLE) renderAddresses()
    }
}
