package dev.offlinechess.core

/** Which side a player is on. Serialized as "w"/"b" to match chess.js and cm-chessboard. */
enum class Color(val code: String) {
    WHITE("w"),
    BLACK("b");

    fun other(): Color = if (this == WHITE) BLACK else WHITE

    companion object {
        fun fromCode(code: String?): Color? = when (code) {
            "w" -> WHITE
            "b" -> BLACK
            else -> null
        }
    }
}

/**
 * Time control in milliseconds. [initialMs] <= 0 means "no clock at all" — the clocks never
 * run and nobody can ever flag. That is the sane default for a casual game outdoors where a
 * phone might sit in a pocket for ten minutes.
 */
data class TimeControl(val initialMs: Long, val incrementMs: Long) {
    val isUnlimited: Boolean get() = initialMs <= 0L

    companion object {
        val UNLIMITED = TimeControl(0L, 0L)

        /** Parses "5+0", "10+5", "unlimited". Returns [UNLIMITED] for anything unrecognized. */
        fun parse(spec: String?): TimeControl {
            if (spec == null) return UNLIMITED
            val trimmed = spec.trim().lowercase()
            if (trimmed.isEmpty() || trimmed == "unlimited" || trimmed == "0") return UNLIMITED
            val parts = trimmed.split("+")
            val minutes = parts.getOrNull(0)?.trim()?.toDoubleOrNull() ?: return UNLIMITED
            val incrementSeconds = parts.getOrNull(1)?.trim()?.toLongOrNull() ?: 0L
            if (minutes <= 0.0) return UNLIMITED
            return TimeControl(
                initialMs = (minutes * 60_000).toLong(),
                incrementMs = incrementSeconds * 1000L,
            )
        }
    }
}

/**
 * One completed half-move.
 *
 * The clock readings are stored per-ply so that a takeback restores the *clocks* as well as the
 * position. Without this, taking back a move would silently hand time to whoever asked for it.
 *
 * [fenAfter] is supplied by the client (chess.js) and stored so a reconnecting or spectating
 * client can render the current position without replaying the whole game.
 */
data class MoveRecord(
    val uci: String,
    val san: String,
    val fenAfter: String,
    val whiteMsAfter: Long,
    val blackMsAfter: Long,
)

enum class GameStatus {
    /** Fewer than two players have claimed a seat. Clocks do not run. */
    WAITING,
    ACTIVE,
    FINISHED,
}

/** [winner] == null means a draw. [reason] is a short machine-ish tag, e.g. "checkmate". */
data class GameResult(val winner: Color?, val reason: String)

/** What a connection is allowed to do. A third connection watches without playing. */
enum class SeatKind { PLAYER, SPECTATOR }

data class Seat(val kind: SeatKind, val color: Color?)
