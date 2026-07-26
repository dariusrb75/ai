package dev.offlinechess.core

import com.google.gson.Gson
import com.google.gson.GsonBuilder
import com.google.gson.JsonSyntaxException

/** A move as sent to clients. Clock readings travel in the snapshot, not per move. */
data class MoveDto(val uci: String, val san: String, val fen: String)

/** Everything a client needs to render the game from scratch. Sent on every state change. */
data class StateSnapshot(
    val moves: List<MoveDto>,
    val fen: String,
    val sideToMove: String,
    val ply: Int,
    val status: String,
    val resultWinner: String?,
    val resultReason: String?,
    val whiteMs: Long,
    val blackMs: Long,
    val clockRunning: Boolean,
    val unlimited: Boolean,
    val incrementMs: Long,
    val initialMs: Long,
    val whiteName: String?,
    val blackName: String?,
    val whiteConnected: Boolean,
    val blackConnected: Boolean,
    val pendingTakebackBy: String?,
    val pendingDrawBy: String?,
)

data class SeatEntry(val token: String, val color: String, val name: String?)

/** On-disk form, so force-killing the app does not lose a game in progress. */
data class PersistedState(
    val initialMs: Long,
    val incrementMs: Long,
    val moves: List<MoveRecord>,
    val seats: List<SeatEntry>,
    val whiteRemainingMs: Long,
    val blackRemainingMs: Long,
    val status: String,
    val resultWinner: String?,
    val resultReason: String?,
)

/**
 * Server → client. One flat shape with a `t` tag rather than a polymorphic hierarchy: Gson omits
 * null fields, so each message serializes to just its relevant keys, and there is no custom
 * adapter to keep in sync.
 */
data class ServerMessage(
    val t: String,
    val state: StateSnapshot? = null,
    val seat: String? = null,
    val color: String? = null,
    val message: String? = null,
    val from: String? = null,
    val time: Long? = null,
    // Clock-only sync fields. Resending the whole snapshot (which carries every move and FEN)
    // just to advance a countdown would waste the radio and the battery.
    val whiteMs: Long? = null,
    val blackMs: Long? = null,
    val clockRunning: Boolean? = null,
)

/** Client → server. Every field optional; [t] dispatches. */
data class ClientMessage(
    val t: String = "",
    val token: String? = null,
    val name: String? = null,
    val color: String? = null,
    val ply: Int? = null,
    val uci: String? = null,
    val san: String? = null,
    val fen: String? = null,
    val accept: Boolean? = null,
    val winner: String? = null,
    val reason: String? = null,
    val timeControl: String? = null,
)

object Protocol {
    val gson: Gson = GsonBuilder().create()

    fun encode(message: ServerMessage): String = gson.toJson(message)

    /** Returns null for malformed input rather than throwing, so one bad frame can't kill a game. */
    fun decode(raw: String): ClientMessage? = try {
        gson.fromJson(raw, ClientMessage::class.java)?.takeIf { it.t.isNotEmpty() }
    } catch (e: JsonSyntaxException) {
        null
    }

    fun encodePersisted(state: PersistedState): String = gson.toJson(state)

    fun decodePersisted(raw: String): PersistedState? = try {
        gson.fromJson(raw, PersistedState::class.java)
    } catch (e: JsonSyntaxException) {
        null
    }
}
