package crowtech.crowhr.ui

import crowtech.crowhr.api.MySchedule
import crowtech.crowhr.api.Named
import crowtech.crowhr.api.RosterPerson
import crowtech.crowhr.api.RosterShift
import crowtech.crowhr.api.RosterView
import crowtech.crowhr.api.Shift
import crowtech.crowhr.api.SwapInput
import crowtech.crowhr.api.SwapRequest
import crowtech.crowhr.api.SwapShift
import crowtech.crowhr.core.CrowJson
import crowtech.crowhr.ui.components.Tone
import crowtech.crowhr.ui.screens.SwapLogic
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Shift swaps, give-aways and open-shift pickups on My schedule (web: /schedules/me). */
class SwapLogicTest {
    private val today = "2026-11-13"
    private fun swap(id: String, kind: String, status: String, direction: String, peer: String? = "Marcus Lim", peerShift: SwapShift? = null) = SwapRequest(
        id = id, kind = kind, status = status, direction = direction, requester = Named("e1", "Nurul Huda"),
        peer = peer?.let { Named("e2", it) }, shift = SwapShift("s1", "2026-11-16", "09:00–17:00"), peerShift = peerShift,
    )

    @Test fun statusWordingAsOnTheWeb() {
        assertEquals("Waiting for colleague" to Tone.Warning, SwapLogic.status("pending_peer"))
        assertEquals("Waiting for approval" to Tone.Warning, SwapLogic.status("pending_approval"))
        assertEquals("Approved" to Tone.Success, SwapLogic.status("approved"))
        assertEquals("Not approved" to Tone.Danger, SwapLogic.status("rejected"))
        assertEquals("Declined", SwapLogic.status("declined").first)
        assertEquals("Expired", SwapLogic.status("expired").first)
    }

    @Test fun offersWaitingForMeAndWhatIAskedFor() {
        val swaps = listOf(
            swap("a", "giveaway", "pending_peer", "incoming"),
            swap("b", "swap", "pending_approval", "incoming"),
            swap("c", "pickup", "pending_approval", "outgoing", peer = null),
            swap("d", "swap", "declined", "outgoing"),
            swap("e", "giveaway", "pending_peer", "other"),
        )
        assertEquals(listOf("a"), SwapLogic.incoming(swaps).map { it.id })
        assertEquals(listOf("c", "d"), SwapLogic.outgoing(swaps).map { it.id })
        assertTrue(SwapLogic.cancellable(swaps[2]))
        assertFalse(SwapLogic.cancellable(swaps[3]))
        assertEquals(10, SwapLogic.outgoing(List(14) { swap("x$it", "pickup", "approved", "outgoing") }).size)
    }

    @Test fun sentences() {
        assertEquals("Nurul Huda offers you their shift on Mon 16 Nov 2026 09:00–17:00.", SwapLogic.offerText(swap("a", "giveaway", "pending_peer", "incoming")))
        assertEquals(
            "Nurul Huda asks to swap their Mon 16 Nov 2026 09:00–17:00 for your Tue 17 Nov 2026 10:00–18:00.",
            SwapLogic.offerText(swap("a", "swap", "pending_peer", "incoming", peerShift = SwapShift("s2", "2026-11-17", "10:00–18:00"))),
        )
        assertEquals("Pick up Mon 16 Nov 2026 09:00–17:00", SwapLogic.requestTitle(swap("c", "pickup", "pending_approval", "outgoing", peer = null)))
        assertEquals("Swap Mon 16 Nov 2026 09:00–17:00 with Marcus Lim", SwapLogic.requestTitle(swap("d", "swap", "declined", "outgoing")))
        assertEquals("Give away Mon 16 Nov 2026 09:00–17:00 to Marcus Lim", SwapLogic.requestTitle(swap("d", "giveaway", "declined", "outgoing")))
    }

    @Test fun whichShiftsCanBeOfferedOrPickedUp() {
        val mine = Shift(id = "s1", rosterId = "r1", date = "2026-11-16", start = "09:00", end = "17:00")
        assertTrue(SwapLogic.canOffer(mine, today))
        assertTrue(SwapLogic.canOffer(mine.copy(date = today), today))
        assertFalse(SwapLogic.canOffer(mine.copy(date = "2026-11-12"), today))
        assertFalse(SwapLogic.canOffer(mine.copy(kind = "rest"), today))
        assertFalse(SwapLogic.canOffer(mine.copy(pendingSwap = true), today))
        // An older server sends no roster id: nothing to load colleagues from.
        assertFalse(SwapLogic.canOffer(mine.copy(rosterId = ""), today))
        val open = Shift(id = "s1", rosterId = "r1", date = "2026-11-16")
        assertTrue(SwapLogic.askedFor(open, listOf(swap("c", "pickup", "pending_approval", "outgoing", peer = null))))
        assertFalse(SwapLogic.askedFor(open, listOf(swap("c", "pickup", "cancelled", "outgoing", peer = null))))
    }

    private val roster = RosterView(
        employees = listOf(RosterPerson("me", "Nurul Huda"), RosterPerson("e2", "Marcus Lim")),
        shifts = listOf(
            RosterShift("s1", "me", "shift", "2026-11-16", "09:00", "17:00"),
            RosterShift("s2", "e2", "shift", "2026-11-17", "10:00", "18:00"),
            RosterShift("s3", "e2", "rest", "2026-11-18"),
            RosterShift("s4", "e2", "shift", "2026-11-12", "10:00", "18:00"),
            RosterShift("s5", "e2", "shift", "2026-11-19", "10:00", "18:00", pendingSwap = true),
            RosterShift("s6", null, "shift", "2026-11-19", "10:00", "18:00"),
        ),
    )

    @Test fun colleaguesAndTheirShiftsFromTheRoster() {
        assertEquals(listOf("e2"), SwapLogic.colleagues(roster, "me").map { it.id })
        assertEquals(listOf("s2"), SwapLogic.peerShifts(roster, "e2", today).map { it.id })
        assertTrue(SwapLogic.peerShifts(roster, null, today).isEmpty())
        assertEquals("Tue 17 Nov 2026 10:00–18:00", SwapLogic.shiftLabel(roster.shifts[1]))
    }

    @Test fun theOfferSaysWhatIsMissingAndSendsOnlyWhatTheKindNeeds() {
        assertEquals("Choose the colleague to offer it to.", SwapLogic.problem("swap", null, null, ""))
        assertEquals("Choose their shift you'd take, or give the shift away instead.", SwapLogic.problem("swap", "e2", null, ""))
        assertNull(SwapLogic.problem("giveaway", "e2", null, ""))
        assertNull(SwapLogic.problem("swap", "e2", "s2", "Can't make it, family dinner"))
        assertEquals("Keep the note to 200 characters.", SwapLogic.problem("giveaway", "e2", null, "x".repeat(201)))
        assertEquals(SwapInput("giveaway", "s1", "e2", null, null), SwapLogic.input("giveaway", "s1", "e2", "s2", "  "))
        assertEquals(SwapInput("swap", "s1", "e2", "s2", "Thanks!"), SwapLogic.input("swap", "s1", "e2", "s2", " Thanks! "))
        val body = CrowJson.encodeToString(SwapInput.serializer(), SwapInput(kind = "pickup", shiftId = "s6"))
        assertEquals("""{"kind":"pickup","shiftId":"s6"}""", body)
    }

    @Test fun myScheduleWithSwapsDecodesAndOlderServersHaveNone() {
        val s = CrowJson.decodeFromString(
            MySchedule.serializer(),
            """{"employeeId":"me","from":"2026-11-13","to":"2026-11-26","shifts":[{"id":"s1","rosterId":"r1","scopeLabel":"HQ","date":"2026-11-16",
               "kind":"shift","start":"09:00","end":"17:00","breakMinutes":60,"paidMinutes":420,"templateCode":null,"colour":"plain","note":null,"pendingSwap":false}],
               "weeks":[],"openShifts":[],"swaps":[{"id":"w1","kind":"giveaway","status":"pending_peer","direction":"incoming",
               "requester":{"id":"e2","name":"Marcus Lim"},"peer":{"id":"me","name":"Nurul Huda"},"shift":{"id":"s9","date":"2026-11-17","time":"10:00–18:00"},
               "peerShift":null,"note":"Family dinner","reason":null,"approvalRequestId":null,"createdAt":"2026-11-13T01:00:00.000Z","expiresAt":"2026-11-17T02:00:00.000Z"}]}""",
        )
        assertEquals("r1", s.shifts.single().rosterId)
        assertEquals("Marcus Lim", SwapLogic.incoming(s.swaps).single().requester.name)
        val old = CrowJson.decodeFromString(MySchedule.serializer(), """{"from":"2026-11-13","to":"2026-11-26","shifts":[{"id":"s1","date":"2026-11-16"}]}""")
        assertTrue(old.swaps.isEmpty())
        assertEquals("", old.shifts.single().rosterId)
    }
}
