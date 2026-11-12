package crowtech.crowhr.ui

import crowtech.crowhr.api.CalendarEntry
import crowtech.crowhr.api.CalendarHoliday
import crowtech.crowhr.api.CalendarPerson
import crowtech.crowhr.api.LeaveCalendar
import crowtech.crowhr.api.Me
import crowtech.crowhr.api.MeOrg
import crowtech.crowhr.api.MeUser
import crowtech.crowhr.core.CrowJson
import crowtech.crowhr.ui.screens.LeaveCalendarLogic
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

/** The leave calendar as a list by day (the web's phone layout), and who gets the team view. */
class LeaveCalendarTest {
    private fun me(vararg scopes: String) = Me(
        MeUser("u1", "kaiwen@example.com", "Kai Wen"), MeOrg("o1", "Kampong Kopi"), "m1",
        permissions = if (scopes.isEmpty()) emptyMap() else mapOf("leave:read" to scopes.toList()),
    )

    @Test fun managersAndHrSeeTheTeamViewOthersWhosAway() {
        assertTrue(LeaveCalendarLogic.wide(me("team")))
        assertEquals("team", LeaveCalendarLogic.defaultView(me("team", "own")))
        assertEquals("My team", LeaveCalendarLogic.teamLabel(me("team")))
        assertEquals("Everyone", LeaveCalendarLogic.teamLabel(me("all")))
        assertFalse(LeaveCalendarLogic.wide(me("own")))
        assertEquals("org", LeaveCalendarLogic.defaultView(me("own")))
        // Not loaded yet, or an older server without permissions: the view anyone may see.
        assertEquals("org", LeaveCalendarLogic.defaultView(null))
        assertEquals("org", LeaveCalendarLogic.defaultView(me()))
    }

    @Test fun meDecodesThePermissionScopes() {
        val m = CrowJson.decodeFromString(
            Me.serializer(),
            """{"user":{"id":"u","email":"e@x","displayName":"K"},"organisation":{"id":"o","name":"O"},"membershipId":"m",
               "permissions":{"leave:read":["team","own"],"claims:read":["team"]},"demoCompany":{"expiresAt":"2026-11-16T06:00:00.000Z"}}""",
        )
        assertEquals(listOf("team", "own"), m.scopes("leave:read"))
        assertEquals(emptyList<String>(), m.scopes("payroll:read"))
        assertEquals("2026-11-16T06:00:00.000Z", m.demoCompany!!.expiresAt)
    }

    @Test fun twoWeeksFromTheMonday() {
        assertEquals(LocalDate.parse("2026-11-09"), LeaveCalendarLogic.mondayOf(LocalDate.parse("2026-11-13")))
        assertEquals(LocalDate.parse("2026-11-09"), LeaveCalendarLogic.mondayOf(LocalDate.parse("2026-11-09")))
        assertEquals(LocalDate.parse("2026-11-09"), LeaveCalendarLogic.mondayOf(LocalDate.parse("2026-11-15")))
        assertEquals("9–22 Nov 2026", LeaveCalendarLogic.rangeLabel(LocalDate.parse("2026-11-09"), LocalDate.parse("2026-11-22")))
        assertEquals("23 Nov – 6 Dec 2026", LeaveCalendarLogic.rangeLabel(LocalDate.parse("2026-11-23"), LocalDate.parse("2026-12-06")))
        assertEquals("28 Dec 2026 – 10 Jan 2027", LeaveCalendarLogic.rangeLabel(LocalDate.parse("2026-12-28"), LocalDate.parse("2027-01-10")))
    }

    @Test fun daysWithSomeoneAwayOrAHolidayInOrder() {
        val cal = LeaveCalendar(
            from = "2026-11-09", to = "2026-11-22",
            holidays = listOf(CalendarHoliday("2026-11-10", "Deepavali")),
            people = listOf(
                CalendarPerson("e1", "Nadia Rahman", entries = listOf(
                    CalendarEntry("2026-11-18", "full", "approved", "Annual leave"),
                    CalendarEntry("2026-11-11", "full", "approved", "Sick leave"),
                )),
                CalendarPerson("e2", "Tan Wei Ming", self = true, entries = listOf(CalendarEntry("2026-11-18", "am", "pending", "Annual leave"))),
                CalendarPerson("e3", "Nurul Huda", entries = listOf(CalendarEntry("2026-12-01", "full", "approved", "Annual leave"))),
            ),
        )
        val days = LeaveCalendarLogic.days(cal)
        assertEquals(listOf("2026-11-10", "2026-11-11", "2026-11-18"), days.map { it.date })
        assertEquals("Deepavali", days[0].holiday)
        assertTrue(days[0].rows.isEmpty())
        assertEquals(listOf("Nadia Rahman", "Tan Wei Ming"), days[2].rows.map { it.name })
        assertEquals("Tan Wei Ming (you): Annual leave, morning, waiting for approval", LeaveCalendarLogic.spoken(days[2].rows[1]))
        assertEquals("Nadia Rahman: Annual leave", LeaveCalendarLogic.spoken(days[2].rows[0]))
        assertEquals("Afternoon", LeaveCalendarLogic.halfDay("pm"))
        assertEquals(null, LeaveCalendarLogic.halfDay("full"))
    }

    @Test fun theServersCalendarDecodes() {
        val cal = CrowJson.decodeFromString(
            LeaveCalendar.serializer(),
            """{"from":"2026-11-09","to":"2026-11-22","holidays":[{"date":"2026-11-10","name":"Deepavali"}],
               "people":[{"employeeId":"e1","name":"Nadia","self":false,"entries":[{"date":"2026-11-11","session":"full",
               "status":"approved","label":"Away","typeCode":null,"requestId":null}]}]}""",
        )
        assertEquals("Away", LeaveCalendarLogic.days(cal)[1].rows.single().entry.label)
    }
}
