package dev.offlinechess.core

import java.io.File

/**
 * Persists the game so that force-killing the app, or Android reclaiming it in the background,
 * does not throw away a game in progress.
 */
interface GameStore {
    fun save(state: PersistedState)

    fun load(): PersistedState?

    fun clear()
}

/** Does nothing. Used in tests that don't care about persistence. */
object NoopGameStore : GameStore {
    override fun save(state: PersistedState) = Unit
    override fun load(): PersistedState? = null
    override fun clear() = Unit
}

/**
 * Writes the game as JSON to a single file.
 *
 * Writes go to a temp file and are then renamed over the target, so a crash mid-write leaves the
 * previous good save intact rather than a truncated file.
 */
class FileGameStore(private val file: File) : GameStore {

    override fun save(state: PersistedState) {
        try {
            file.parentFile?.mkdirs()
            val temp = File(file.parentFile, file.name + ".tmp")
            temp.writeText(Protocol.encodePersisted(state))
            if (!temp.renameTo(file)) {
                // Some filesystems refuse rename onto an existing file.
                file.delete()
                temp.renameTo(file)
            }
        } catch (e: Exception) {
            // Losing the save file must never take the running game down with it.
            System.err.println("offline-chess: failed to save game: ${e.message}")
        }
    }

    override fun load(): PersistedState? = try {
        if (file.isFile) Protocol.decodePersisted(file.readText()) else null
    } catch (e: Exception) {
        System.err.println("offline-chess: failed to load game: ${e.message}")
        null
    }

    override fun clear() {
        runCatching { file.delete() }
    }
}
