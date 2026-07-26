package dev.offlinechess.core

import kotlin.math.max

const val START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

/** Result of trying to apply a move. */
sealed class MoveOutcome {
    data class Accepted(val record: MoveRecord) : MoveOutcome()

    /** [reason] is a short tag the client can branch on, e.g. "ply_mismatch". */
    data class Rejected(val reason: String) : MoveOutcome()
}

/**
 * The authoritative game state.
 *
 * This class deliberately knows **nothing about the rules of chess**. It keeps the move log, the
 * clocks and the seats; legality, checkmate and draw detection all live in chess.js on the
 * client. Two reasons: there is exactly one rules implementation so the two phones can never
 * disagree with each other, and cheat-resistance is irrelevant when both players are sitting on
 * the same log in the woods.
 *
 * Whose clock is running is derived purely from the *number* of moves played, which needs no
 * chess knowledge to get right.
 *
 * Not thread-safe by itself; [ChessServer] serializes all access through a single lock.
 *
 * @param now injectable time source, so clock behaviour is deterministically testable.
 */
class GameSession(
    initialTimeControl: TimeControl = TimeControl.UNLIMITED,
    private val now: () -> Long = System::currentTimeMillis,
) {
    var timeControl: TimeControl = initialTimeControl
        private set

    private val moveLog = mutableListOf<MoveRecord>()

    /** Insertion-ordered so the first two tokens to arrive get the seats. */
    private val seatsByToken = LinkedHashMap<String, Color>()
    private val namesByToken = HashMap<String, String>()
    private val connectedTokens = HashSet<String>()

    private var whiteRemainingMs: Long = initialTimeControl.initialMs
    private var blackRemainingMs: Long = initialTimeControl.initialMs

    /** Non-null while a clock is actually counting down. */
    private var runningSince: Long? = null

    var status: GameStatus = GameStatus.WAITING
        private set
    var result: GameResult? = null
        private set

    var pendingTakebackBy: Color? = null
        private set
    var pendingDrawBy: Color? = null
        private set

    val moves: List<MoveRecord> get() = moveLog

    /** Standard chess always starts with white, so ply parity is enough. */
    val sideToMove: Color get() = if (moveLog.size % 2 == 0) Color.WHITE else Color.BLACK

    val fen: String get() = moveLog.lastOrNull()?.fenAfter ?: START_FEN

    private val bothSeated: Boolean get() = seatsByToken.size >= 2

    fun colorOf(token: String): Color? = seatsByToken[token]

    fun nameOf(color: Color): String? =
        seatsByToken.entries.firstOrNull { it.value == color }?.let { namesByToken[it.key] }

    fun isConnected(color: Color): Boolean =
        seatsByToken.entries.any { it.value == color && it.key in connectedTokens }

    // ---------------------------------------------------------------- seats

    /**
     * Claims or reclaims a seat. A returning [token] always gets its original colour back —
     * this is what makes reconnect-after-the-phone-locked work instead of losing the game.
     */
    fun join(token: String, name: String?, preferredColor: Color?): Seat {
        if (!name.isNullOrBlank()) namesByToken[token] = name
        connectedTokens += token

        seatsByToken[token]?.let { existing ->
            updateClockRunState()
            return Seat(SeatKind.PLAYER, existing)
        }

        if (bothSeated) {
            // Both seats are taken by other tokens: watch, don't play.
            return Seat(SeatKind.SPECTATOR, null)
        }

        val taken = seatsByToken.values.toSet()
        val color = preferredColor?.takeIf { it !in taken }
            ?: Color.values().first { it !in taken }
        seatsByToken[token] = color

        if (bothSeated && status == GameStatus.WAITING) {
            status = GameStatus.ACTIVE
        }
        updateClockRunState()
        return Seat(SeatKind.PLAYER, color)
    }

    /**
     * Marks a connection gone. Deliberately **never forfeits**: phones sleep in pockets and iOS
     * drops sockets when Safari backgrounds, and losing a game to that would be infuriating.
     * The mover's clock pauses instead (see [updateClockRunState]).
     */
    fun disconnect(token: String) {
        connectedTokens -= token
        updateClockRunState()
    }

    // ---------------------------------------------------------------- clocks

    /** Live remaining time, accounting for the clock currently ticking. */
    fun remainingMs(color: Color): Long {
        val base = if (color == Color.WHITE) whiteRemainingMs else blackRemainingMs
        if (timeControl.isUnlimited) return base
        val since = runningSince
        if (since != null && color == sideToMove) {
            return max(0L, base - (now() - since))
        }
        return base
    }

    val clockRunning: Boolean get() = runningSince != null

    /** Folds elapsed time into the stored remaining and stops the clock. */
    private fun settleClock() {
        val since = runningSince ?: return
        runningSince = null
        if (timeControl.isUnlimited) return
        val elapsed = now() - since
        if (sideToMove == Color.WHITE) {
            whiteRemainingMs = max(0L, whiteRemainingMs - elapsed)
        } else {
            blackRemainingMs = max(0L, blackRemainingMs - elapsed)
        }
    }

    /**
     * A clock runs only when the game is live, both seats are filled, and **the player to move
     * is actually connected**. That last condition is the field-reliability rule: a locked phone
     * pauses its own clock rather than bleeding out.
     */
    private fun updateClockRunState() {
        val shouldRun = status == GameStatus.ACTIVE &&
            !timeControl.isUnlimited &&
            bothSeated &&
            isConnected(sideToMove)

        if (shouldRun && runningSince == null) {
            runningSince = now()
        } else if (!shouldRun && runningSince != null) {
            settleClock()
        }
    }

    /**
     * Checks for a flag fall. Called on a timer by the server.
     * @return true if this changed the game state (and so needs broadcasting).
     */
    fun tick(): Boolean {
        if (status != GameStatus.ACTIVE || timeControl.isUnlimited) return false
        if (runningSince == null) return false
        if (remainingMs(sideToMove) > 0L) return false
        val flagged = sideToMove
        finish(GameResult(flagged.other(), "timeout"))
        return true
    }

    // ---------------------------------------------------------------- moves

    /**
     * @param ply the number of moves the client believes have already been played. A mismatch
     *   means the client is out of sync (a resend after a flaky hotspot, or a reconnect race),
     *   and the move is refused rather than double-applied.
     */
    fun applyMove(
        token: String,
        ply: Int,
        uci: String,
        san: String,
        fenAfter: String,
    ): MoveOutcome {
        if (status != GameStatus.ACTIVE) return MoveOutcome.Rejected("game_not_active")
        val color = seatsByToken[token] ?: return MoveOutcome.Rejected("not_a_player")
        if (color != sideToMove) return MoveOutcome.Rejected("not_your_turn")
        if (ply != moveLog.size) return MoveOutcome.Rejected("ply_mismatch")

        settleClock()

        // Settling may have taken the mover to zero; they flagged before completing the move.
        if (!timeControl.isUnlimited && remainingMs(color) <= 0L) {
            finish(GameResult(color.other(), "timeout"))
            return MoveOutcome.Rejected("flagged")
        }

        if (!timeControl.isUnlimited && timeControl.incrementMs > 0L) {
            if (color == Color.WHITE) whiteRemainingMs += timeControl.incrementMs
            else blackRemainingMs += timeControl.incrementMs
        }

        val record = MoveRecord(
            uci = uci,
            san = san,
            fenAfter = fenAfter,
            whiteMsAfter = whiteRemainingMs,
            blackMsAfter = blackRemainingMs,
        )
        moveLog += record

        // Playing a move implicitly withdraws/declines any outstanding offer.
        pendingDrawBy = null
        pendingTakebackBy = null

        updateClockRunState()
        return MoveOutcome.Accepted(record)
    }

    // ---------------------------------------------------------------- offers

    /**
     * A player may only ask to take back a move they have actually played, so black cannot undo
     * white's opening move before having moved at all.
     */
    fun requestTakeback(token: String): Boolean {
        val color = seatsByToken[token] ?: return false
        val minimumPlies = if (color == Color.WHITE) 1 else 2
        if (moveLog.size < minimumPlies) return false
        pendingTakebackBy = color
        return true
    }

    /** Only the opponent of the requester may answer. */
    fun respondTakeback(token: String, accept: Boolean): Boolean {
        val color = seatsByToken[token] ?: return false
        val requester = pendingTakebackBy ?: return false
        if (color == requester) return false
        pendingTakebackBy = null
        if (accept) undoBackTo(requester)
        return true
    }

    /**
     * Rewinds until it is [requester]'s turn again, restoring the clock readings for that ply
     * along with the position.
     *
     * This undoes one ply when the requester has just moved, and two when the opponent has
     * already replied — "take back *my* move" is what a player means, so undoing a single ply
     * would hand back the opponent's move instead.
     */
    private fun undoBackTo(requester: Color) {
        if (moveLog.isEmpty()) return
        settleClock()
        do {
            moveLog.removeAt(moveLog.size - 1)
        } while (moveLog.isNotEmpty() && sideToMove != requester)
        val previous = moveLog.lastOrNull()
        whiteRemainingMs = previous?.whiteMsAfter ?: timeControl.initialMs
        blackRemainingMs = previous?.blackMsAfter ?: timeControl.initialMs
        // A takeback also un-finishes a game, so an accidental mate or a premature resignation
        // can be walked back.
        if (status == GameStatus.FINISHED) {
            status = if (bothSeated) GameStatus.ACTIVE else GameStatus.WAITING
            result = null
        }
        updateClockRunState()
    }

    fun offerDraw(token: String): Boolean {
        val color = seatsByToken[token] ?: return false
        if (status != GameStatus.ACTIVE) return false
        pendingDrawBy = color
        return true
    }

    fun respondDraw(token: String, accept: Boolean): Boolean {
        val color = seatsByToken[token] ?: return false
        val offerer = pendingDrawBy ?: return false
        if (color == offerer) return false
        pendingDrawBy = null
        if (accept) finish(GameResult(null, "agreement"))
        return true
    }

    fun resign(token: String): Boolean {
        val color = seatsByToken[token] ?: return false
        if (status != GameStatus.ACTIVE) return false
        finish(GameResult(color.other(), "resignation"))
        return true
    }

    /**
     * Records an outcome the *client* detected, since the client is where the rules live:
     * checkmate, stalemate, threefold repetition, the fifty-move rule, insufficient material.
     */
    fun declareGameOver(token: String, winner: Color?, reason: String): Boolean {
        if (seatsByToken[token] == null) return false
        if (status != GameStatus.ACTIVE) return false
        finish(GameResult(winner, reason))
        return true
    }

    private fun finish(gameResult: GameResult) {
        settleClock()
        status = GameStatus.FINISHED
        result = gameResult
        pendingDrawBy = null
        pendingTakebackBy = null
    }

    /** Resets for a rematch, swapping colours so players alternate as white. */
    fun newGame(timeControl: TimeControl): Boolean {
        this.timeControl = timeControl
        moveLog.clear()
        runningSince = null
        whiteRemainingMs = timeControl.initialMs
        blackRemainingMs = timeControl.initialMs
        result = null
        pendingDrawBy = null
        pendingTakebackBy = null
        for (entry in seatsByToken.entries) {
            entry.setValue(entry.value.other())
        }
        status = if (bothSeated) GameStatus.ACTIVE else GameStatus.WAITING
        updateClockRunState()
        return true
    }

    // ---------------------------------------------------------------- snapshot

    fun snapshot(): StateSnapshot = StateSnapshot(
        moves = moveLog.map { MoveDto(it.uci, it.san, it.fenAfter) },
        fen = fen,
        sideToMove = sideToMove.code,
        ply = moveLog.size,
        status = status.name.lowercase(),
        resultWinner = result?.winner?.code,
        resultReason = result?.reason,
        whiteMs = remainingMs(Color.WHITE),
        blackMs = remainingMs(Color.BLACK),
        clockRunning = clockRunning,
        unlimited = timeControl.isUnlimited,
        incrementMs = timeControl.incrementMs,
        initialMs = timeControl.initialMs,
        whiteName = nameOf(Color.WHITE),
        blackName = nameOf(Color.BLACK),
        whiteConnected = isConnected(Color.WHITE),
        blackConnected = isConnected(Color.BLACK),
        pendingTakebackBy = pendingTakebackBy?.code,
        pendingDrawBy = pendingDrawBy?.code,
    )

    /** Full state for writing to disk, so killing the app does not lose the game. */
    fun persist(): PersistedState = PersistedState(
        initialMs = timeControl.initialMs,
        incrementMs = timeControl.incrementMs,
        moves = moveLog.toList(),
        seats = seatsByToken.map { SeatEntry(it.key, it.value.code, namesByToken[it.key]) },
        whiteRemainingMs = remainingMs(Color.WHITE),
        blackRemainingMs = remainingMs(Color.BLACK),
        status = status.name,
        resultWinner = result?.winner?.code,
        resultReason = result?.reason,
    )

    fun restore(state: PersistedState) {
        timeControl = TimeControl(state.initialMs, state.incrementMs)
        moveLog.clear()
        moveLog += state.moves
        seatsByToken.clear()
        namesByToken.clear()
        connectedTokens.clear()
        for (seat in state.seats) {
            val color = Color.fromCode(seat.color) ?: continue
            seatsByToken[seat.token] = color
            seat.name?.let { namesByToken[seat.token] = it }
        }
        whiteRemainingMs = state.whiteRemainingMs
        blackRemainingMs = state.blackRemainingMs
        runningSince = null
        status = runCatching { GameStatus.valueOf(state.status) }.getOrDefault(GameStatus.WAITING)
        result = state.resultReason?.let { GameResult(Color.fromCode(state.resultWinner), it) }
        // Everyone is disconnected after a restore, so clocks stay paused until players rejoin.
        if (status == GameStatus.ACTIVE && !bothSeated) status = GameStatus.WAITING
    }
}
