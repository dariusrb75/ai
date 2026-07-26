package dev.offlinechess.tools

import dev.offlinechess.core.ChessServer
import dev.offlinechess.core.FileAssetSource
import dev.offlinechess.core.NoopGameStore
import dev.offlinechess.core.TimeControl
import java.io.File

/**
 * Headless host for development and automated tests.
 *
 * Usage: `gradlew :tools:run --args="[port] [webDir] [timeControl]"`
 * e.g. `--args="8080 web 5+3"`.
 */
fun main(args: Array<String>) {
    val port = args.getOrNull(0)?.toIntOrNull() ?: ChessServer.DEFAULT_PORT
    val webDir = File(args.getOrNull(1) ?: "web").absoluteFile
    val timeControl = TimeControl.parse(args.getOrNull(2))

    if (!webDir.isDirectory) {
        System.err.println("web directory not found: $webDir")
        System.err.println("run from the repository root, or pass the path as the 2nd argument")
        return
    }

    val server = ChessServer(
        port = port,
        assets = FileAssetSource(webDir),
        store = NoopGameStore,
        timeControl = timeControl,
    )
    server.start()

    val clock = if (timeControl.isUnlimited) "unlimited" else
        "${timeControl.initialMs / 60000}+${timeControl.incrementMs / 1000}"
    println("offline-chess dev host")
    println("  serving : $webDir")
    println("  url     : http://127.0.0.1:$port/")
    println("  clock   : $clock")
    println("Press Ctrl+C to stop.")

    Runtime.getRuntime().addShutdownHook(Thread { server.stop() })

    // NanoHTTPD's listener thread is non-daemon when started with daemon=false, but block
    // explicitly so the process lifetime is obvious.
    Thread.currentThread().join()
}
