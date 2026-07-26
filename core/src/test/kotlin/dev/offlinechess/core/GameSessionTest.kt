package dev.offlinechess.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Clock behaviour is driven by an injected time source rather than real sleeps, so these tests
 * are deterministic and instant.
 */
class GameSessionTest {

    private var fakeNow = 1_000_000L
    private fun advance(ms: Long) {
        fakeNow += ms
    }

    private fun session(tc: TimeControl = TimeControl.UNLIMITED) =
        GameSession(tc) { fakeNow }

    /** Seats both players and returns the session, with white as "tw" and black as "tb". */
    private fun seated(tc: TimeControl = TimeControl.UNLIMITED): GameSession {
        val s = session(tc)
        s.join("tw", "White Player", Color.WHITE)
        s.join("tb", "Black Player", Color.BLACK)
        return s
    }

    private fun GameSession.move(token: String, uci: String, san: String): MoveOutcome =
        applyMove(token, moves.size, uci, san, "fen-after-${moves.size}")

    // ------------------------------------------------------------------ seats

    @Test
    fun `first two joiners get the seats and the game starts`() {
        val s = session()
        assertEquals(GameStatus.WAITING, s.status)

        val white = s.join("tw", "A", Color.WHITE)
        assertEquals(SeatKind.PLAYER, white.kind)
        assertEquals(Color.WHITE, white.color)
        assertEquals(GameStatus.WAITING, s.status, "one player is not a game")

        val black = s.join("tb", "B", null)
        assertEquals(Color.BLACK, black.color)
        assertEquals(GameStatus.ACTIVE, s.status)
    }

    @Test
    fun `preferred colour is honoured and a clash falls back to the free seat`() {
        val s = session()
        assertEquals(Color.BLACK, s.join("t1", "A", Color.BLACK).color)
        // Both wanted black; the second joiner takes what's left rather than being refused.
        assertEquals(Color.WHITE, s.join("t2", "B", Color.BLACK).color)
    }

    @Test
    fun `a returning token reclaims its original seat`() {
        val s = seated()
        s.disconnect("tw")
        assertFalse(s.isConnected(Color.WHITE))

        val rejoined = s.join("tw", "White Player", Color.BLACK)
        assertEquals(SeatKind.PLAYER, rejoined.kind)
        assertEquals(Color.WHITE, rejoined.color, "must get its own seat back, not the requested one")
        assertTrue(s.isConnected(Color.WHITE))
    }

    @Test
    fun `a third connection becomes a spectator`() {
        val s = seated()
        val third = s.join("t3", "Nosy", Color.WHITE)
        assertEquals(SeatKind.SPECTATOR, third.kind)
        assertNull(third.color)
    }

    @Test
    fun `disconnecting never forfeits the game`() {
        val s = seated(TimeControl(60_000, 0))
        s.disconnect("tw")
        s.disconnect("tb")
        assertEquals(GameStatus.ACTIVE, s.status)
        assertNull(s.result)
    }

    // ------------------------------------------------------------------ moves

    @Test
    fun `moves alternate and are refused out of turn`() {
        val s = seated()
        assertEquals(Color.WHITE, s.sideToMove)

        assertTrue(s.move("tb", "e7e5", "e5") is MoveOutcome.Rejected, "black cannot open")
        assertTrue(s.move("tw", "e2e4", "e4") is MoveOutcome.Accepted)
        assertEquals(Color.BLACK, s.sideToMove)

        val outOfTurn = s.move("tw", "d2d4", "d4") as MoveOutcome.Rejected
        assertEquals("not_your_turn", outOfTurn.reason)
    }

    @Test
    fun `a stale ply is refused so a resent move is never applied twice`() {
        val s = seated()
        s.move("tw", "e2e4", "e4")
        s.move("tb", "e7e5", "e5")
        assertEquals(2, s.moves.size)

        // A flaky hotspot resends white's first move: same payload, now-stale ply.
        val replay = s.applyMove("tw", 0, "e2e4", "e4", "fen") as MoveOutcome.Rejected
        assertEquals("ply_mismatch", replay.reason)
        assertEquals(2, s.moves.size, "the move log must not grow")
    }

    @Test
    fun `a non-player cannot move`() {
        val s = seated()
        val rejected = s.applyMove("stranger", 0, "e2e4", "e4", "fen") as MoveOutcome.Rejected
        assertEquals("not_a_player", rejected.reason)
    }

    @Test
    fun `moves are refused once the game is finished`() {
        val s = seated()
        s.resign("tw")
        val rejected = s.move("tb", "e7e5", "e5") as MoveOutcome.Rejected
        assertEquals("game_not_active", rejected.reason)
    }

    // ------------------------------------------------------------------ clocks

    @Test
    fun `thinking time is deducted from the mover only`() {
        val s = seated(TimeControl(60_000, 0))
        advance(5_000)

        assertEquals(55_000, s.remainingMs(Color.WHITE))
        assertEquals(60_000, s.remainingMs(Color.BLACK), "black's clock must not run on white's turn")

        s.move("tw", "e2e4", "e4")
        assertEquals(55_000, s.remainingMs(Color.WHITE))

        advance(3_000)
        assertEquals(55_000, s.remainingMs(Color.WHITE), "white is settled while black thinks")
        assertEquals(57_000, s.remainingMs(Color.BLACK))
    }

    @Test
    fun `increment is added to the mover after each move`() {
        val s = seated(TimeControl(60_000, 3_000))
        advance(5_000)
        s.move("tw", "e2e4", "e4")
        assertEquals(58_000, s.remainingMs(Color.WHITE), "60s - 5s thought + 3s increment")
    }

    @Test
    fun `an unlimited clock never runs and never flags`() {
        val s = seated(TimeControl.UNLIMITED)
        advance(60 * 60_000)
        assertFalse(s.clockRunning)
        assertFalse(s.tick())
        assertEquals(GameStatus.ACTIVE, s.status)
    }

    @Test
    fun `the mover's clock pauses while their phone is disconnected`() {
        val s = seated(TimeControl(60_000, 0))
        advance(2_000)

        s.disconnect("tw")
        assertEquals(58_000, s.remainingMs(Color.WHITE))
        assertFalse(s.clockRunning, "a locked phone must not bleed time")

        advance(10 * 60_000)
        assertEquals(58_000, s.remainingMs(Color.WHITE), "no time lost while away")
        assertFalse(s.tick(), "and it must not flag while paused")

        s.join("tw", "White Player", null)
        assertTrue(s.clockRunning)
        advance(1_000)
        assertEquals(57_000, s.remainingMs(Color.WHITE))
    }

    @Test
    fun `running out of time loses the game`() {
        val s = seated(TimeControl(10_000, 0))
        advance(9_000)
        assertFalse(s.tick())

        advance(2_000)
        assertTrue(s.tick(), "tick must report the state change")
        assertEquals(GameStatus.FINISHED, s.status)
        assertEquals(Color.BLACK, s.result?.winner)
        assertEquals("timeout", s.result?.reason)
        assertEquals(0, s.remainingMs(Color.WHITE))
    }

    @Test
    fun `a move that arrives after the flag does not save the mover`() {
        val s = seated(TimeControl(10_000, 0))
        advance(11_000)
        val rejected = s.move("tw", "e2e4", "e4") as MoveOutcome.Rejected
        assertEquals("flagged", rejected.reason)
        assertEquals(Color.BLACK, s.result?.winner)
    }

    // ------------------------------------------------------------------ takeback

    @Test
    fun `takeback undoes one ply when the requester has just moved`() {
        val s = seated(TimeControl(60_000, 0))
        advance(5_000)
        s.move("tw", "e2e4", "e4")

        assertTrue(s.requestTakeback("tw"))
        assertEquals(Color.WHITE, s.pendingTakebackBy)
        assertTrue(s.respondTakeback("tb", true))

        assertEquals(0, s.moves.size)
        assertEquals(Color.WHITE, s.sideToMove)
        assertNull(s.pendingTakebackBy)
        assertEquals(60_000, s.remainingMs(Color.WHITE), "the clock is restored, not just the board")
    }

    @Test
    fun `takeback rewinds two plies when the opponent has already replied`() {
        val s = seated()
        s.move("tw", "e2e4", "e4")
        s.move("tb", "e7e5", "e5")
        assertEquals(Color.WHITE, s.sideToMove)

        // White wants their *own* move back, which means black's reply goes too.
        assertTrue(s.requestTakeback("tw"))
        assertTrue(s.respondTakeback("tb", true))

        assertEquals(0, s.moves.size)
        assertEquals(Color.WHITE, s.sideToMove)
    }

    @Test
    fun `takeback leaves the opponent's move alone`() {
        val s = seated()
        s.move("tw", "e2e4", "e4")
        s.move("tb", "e7e5", "e5")

        assertTrue(s.requestTakeback("tb"))
        assertTrue(s.respondTakeback("tw", true))

        assertEquals(1, s.moves.size, "only black's own move is undone")
        assertEquals("e4", s.moves.single().san)
        assertEquals(Color.BLACK, s.sideToMove)
    }

    @Test
    fun `black cannot take back before having moved`() {
        val s = seated()
        s.move("tw", "e2e4", "e4")
        assertFalse(s.requestTakeback("tb"), "black has played nothing to take back")
        assertNull(s.pendingTakebackBy)
    }

    @Test
    fun `a takeback cannot be self-approved`() {
        val s = seated()
        s.move("tw", "e2e4", "e4")
        s.requestTakeback("tw")

        assertFalse(s.respondTakeback("tw", true), "the requester must not answer themselves")
        assertEquals(1, s.moves.size)
        assertEquals(Color.WHITE, s.pendingTakebackBy, "the request stays open")
    }

    @Test
    fun `a declined takeback leaves the game untouched`() {
        val s = seated()
        s.move("tw", "e2e4", "e4")
        s.requestTakeback("tw")
        assertTrue(s.respondTakeback("tb", false))

        assertEquals(1, s.moves.size)
        assertNull(s.pendingTakebackBy)
    }

    @Test
    fun `a takeback can rescue a game that was already lost`() {
        val s = seated()
        s.move("tw", "f2f3", "f3")
        s.declareGameOver("tw", Color.BLACK, "checkmate")
        assertEquals(GameStatus.FINISHED, s.status)

        assertTrue(s.requestTakeback("tw"))
        assertTrue(s.respondTakeback("tb", true))

        assertEquals(GameStatus.ACTIVE, s.status, "taking back un-finishes the game")
        assertNull(s.result)
        assertEquals(0, s.moves.size)
    }

    @Test
    fun `making a move withdraws any outstanding offers`() {
        val s = seated()
        s.move("tw", "e2e4", "e4")
        s.requestTakeback("tw")
        s.offerDraw("tw")

        s.move("tb", "e7e5", "e5")
        assertNull(s.pendingTakebackBy)
        assertNull(s.pendingDrawBy)
    }

    // ------------------------------------------------------------------ endings

    @Test
    fun `resigning hands the win to the opponent`() {
        val s = seated()
        assertTrue(s.resign("tb"))
        assertEquals(GameStatus.FINISHED, s.status)
        assertEquals(Color.WHITE, s.result?.winner)
        assertEquals("resignation", s.result?.reason)
    }

    @Test
    fun `a draw needs both players to agree`() {
        val s = seated()
        assertTrue(s.offerDraw("tw"))
        assertFalse(s.respondDraw("tw", true), "cannot accept your own offer")
        assertEquals(GameStatus.ACTIVE, s.status)

        assertTrue(s.respondDraw("tb", true))
        assertEquals(GameStatus.FINISHED, s.status)
        assertNull(s.result?.winner, "a draw has no winner")
        assertEquals("agreement", s.result?.reason)
    }

    @Test
    fun `a declined draw leaves the game running`() {
        val s = seated()
        s.offerDraw("tw")
        assertTrue(s.respondDraw("tb", false))
        assertEquals(GameStatus.ACTIVE, s.status)
        assertNull(s.pendingDrawBy)
    }

    @Test
    fun `the client reports outcomes it detected with the rules engine`() {
        val s = seated()
        assertTrue(s.declareGameOver("tw", null, "stalemate"))
        assertEquals(GameStatus.FINISHED, s.status)
        assertNull(s.result?.winner)
        assertEquals("stalemate", s.result?.reason)
    }

    @Test
    fun `a rematch keeps the clock when handed the current time control`() {
        val s = seated(TimeControl(300_000, 2_000))
        advance(10_000)
        s.move("tw", "e2e4", "e4")
        s.resign("tb")

        // This is what the server passes when the client asks for a rematch without naming a
        // new time control; the host's chosen clock must survive.
        s.newGame(s.timeControl)

        assertFalse(s.timeControl.isUnlimited, "the clock must not be dropped on a rematch")
        assertEquals(300_000, s.remainingMs(Color.WHITE))
        assertEquals(2_000, s.timeControl.incrementMs)
    }

    @Test
    fun `a rematch resets the board and swaps colours`() {
        val s = seated(TimeControl(60_000, 0))
        advance(5_000)
        s.move("tw", "e2e4", "e4")
        s.resign("tb")

        s.newGame(TimeControl(120_000, 2_000))

        assertEquals(GameStatus.ACTIVE, s.status)
        assertEquals(0, s.moves.size)
        assertNull(s.result)
        assertEquals(120_000, s.remainingMs(Color.BLACK))
        assertEquals(Color.BLACK, s.colorOf("tw"), "players alternate colours between games")
        assertEquals(Color.WHITE, s.colorOf("tb"))
    }

    // ------------------------------------------------------------------ persistence

    @Test
    fun `a game survives a save and reload`() {
        val original = seated(TimeControl(60_000, 2_000))
        advance(4_000)
        original.move("tw", "e2e4", "e4")
        advance(3_000)
        original.move("tb", "g8f6", "Nf6")

        val json = Protocol.encodePersisted(original.persist())
        val restored = session().apply { restore(assertNotNull(Protocol.decodePersisted(json))) }

        assertEquals(2, restored.moves.size)
        assertEquals(listOf("e4", "Nf6"), restored.moves.map { it.san })
        assertEquals("fen-after-1", restored.fen)
        assertEquals(Color.WHITE, restored.sideToMove)
        assertEquals(Color.WHITE, restored.colorOf("tw"))
        assertEquals(original.remainingMs(Color.WHITE), restored.remainingMs(Color.WHITE))
        assertEquals(original.remainingMs(Color.BLACK), restored.remainingMs(Color.BLACK))

        // Nobody is connected straight after a restore, so no clock may be ticking yet.
        assertFalse(restored.clockRunning)

        // And the reloaded game is playable: the original token reclaims its seat.
        assertEquals(Color.WHITE, restored.join("tw", null, null).color)
        assertTrue(restored.move("tw", "d2d4", "d4") is MoveOutcome.Accepted)
    }

    @Test
    fun `a finished game survives a reload`() {
        val original = seated()
        original.move("tw", "e2e4", "e4")
        original.declareGameOver("tw", Color.WHITE, "checkmate")

        val json = Protocol.encodePersisted(original.persist())
        val restored = session().apply { restore(assertNotNull(Protocol.decodePersisted(json))) }

        assertEquals(GameStatus.FINISHED, restored.status)
        assertEquals(Color.WHITE, restored.result?.winner)
        assertEquals("checkmate", restored.result?.reason)
    }

    // ------------------------------------------------------------------ snapshot

    @Test
    fun `the snapshot carries what a client needs to render`() {
        val s = seated(TimeControl(60_000, 1_000))
        advance(5_000)
        s.move("tw", "e2e4", "e4")

        val snap = s.snapshot()
        assertEquals(1, snap.ply)
        assertEquals("b", snap.sideToMove)
        assertEquals("active", snap.status)
        assertEquals("fen-after-0", snap.fen)
        assertEquals(listOf("e4"), snap.moves.map { it.san })
        assertEquals("White Player", snap.whiteName)
        assertEquals("Black Player", snap.blackName)
        assertTrue(snap.whiteConnected)
        assertTrue(snap.blackConnected)
        assertFalse(snap.unlimited)
        assertEquals(56_000, snap.whiteMs)
        assertNull(snap.resultReason)
    }

    // ------------------------------------------------------------------ time control parsing

    @Test
    fun `time control specs are parsed`() {
        assertEquals(TimeControl(300_000, 0), TimeControl.parse("5+0"))
        assertEquals(TimeControl(600_000, 5_000), TimeControl.parse("10+5"))
        assertEquals(TimeControl(90_000, 0), TimeControl.parse("1.5"))
        assertTrue(TimeControl.parse("unlimited").isUnlimited)
        assertTrue(TimeControl.parse(null).isUnlimited)
        assertTrue(TimeControl.parse("nonsense").isUnlimited)
        assertTrue(TimeControl.parse("0+2").isUnlimited)
    }
}
