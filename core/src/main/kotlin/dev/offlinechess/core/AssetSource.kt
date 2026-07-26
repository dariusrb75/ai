package dev.offlinechess.core

import java.io.File
import java.io.InputStream

/**
 * Supplies the web client's files to the server.
 *
 * The only reason this is an interface: on Android the files live inside the APK and are read
 * through `AssetManager`, while in tests and `:tools` they are plain files under `web/`. Keeping
 * that difference behind one interface is what lets `:core` stay Android-free and therefore
 * testable on a desktop JVM.
 */
interface AssetSource {
    /** @param path relative, slash-separated, already normalized (no leading slash, no "..") */
    fun open(path: String): InputStream?

    fun exists(path: String): Boolean
}

/** Serves assets from a directory on disk. Used by `:tools` and the unit tests. */
class FileAssetSource(private val root: File) : AssetSource {

    override fun open(path: String): InputStream? {
        val file = resolveSafely(path) ?: return null
        return if (file.isFile) file.inputStream() else null
    }

    override fun exists(path: String): Boolean = resolveSafely(path)?.isFile == true

    /**
     * Guards against path traversal escaping [root]. Belt and braces — [ChessServer] already
     * sanitizes — but this server binds to 0.0.0.0 on a shared hotspot, so a second check on the
     * filesystem boundary is cheap insurance.
     */
    private fun resolveSafely(path: String): File? {
        val candidate = File(root, path).canonicalFile
        val base = root.canonicalFile
        return if (candidate == base || candidate.path.startsWith(base.path + File.separator)) {
            candidate
        } else {
            null
        }
    }
}
