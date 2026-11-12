package crowtech.crowhr.ui

import crowtech.crowhr.api.LeaveApplication
import crowtech.crowhr.api.LeaveChild
import crowtech.crowhr.api.LeaveQuoteRequest
import crowtech.crowhr.api.LeaveRequest
import crowtech.crowhr.api.LeaveType
import crowtech.crowhr.core.CrowJson
import crowtech.crowhr.ui.screens.childLabel
import crowtech.crowhr.ui.screens.leaveChildId
import crowtech.crowhr.ui.screens.leaveFormProblem
import crowtech.crowhr.ui.screens.leaveSessions
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.ByteArrayInputStream
import java.time.LocalDate

class LeaveFormTest {
    private val halfDays = LeaveType("t1", "annual", "Annual leave", halfDays = true)
    private val wholeDays = LeaveType("t2", "no_pay", "No-pay leave", halfDays = false)
    private val mon = LocalDate.parse("2026-11-16")
    private val wed = LocalDate.parse("2026-11-18")

    @Test fun aHalfDayIsSentOnlyWhenTheDayChoiceIsShown() {
        assertEquals("am" to "am", leaveSessions(mon, mon, halfDays, "am"))
        assertEquals("pm" to "pm", leaveSessions(mon, mon, halfDays, "pm"))
        // Morning chosen, then the last day moved: the choice is hidden, so a full day each.
        assertEquals("full" to "full", leaveSessions(mon, wed, halfDays, "am"))
        // Morning chosen, then a type without half days.
        assertEquals("full" to "full", leaveSessions(mon, mon, wholeDays, "am"))
        assertEquals("full" to "full", leaveSessions(mon, mon, null, "pm"))
        assertEquals("full" to "full", leaveSessions(mon, mon, halfDays, "evening"))
    }

    private val childcare = LeaveType("t3", "childcare", "Childcare leave", halfDays = true, needsChild = true)
    private val kids = listOf(LeaveChild("k1", "Tan Yu Xuan", birthDate = "2026-11-03"), LeaveChild("k2", "Tan Yu Ming", expectedDeliveryDate = "2027-02-01"))

    @Test fun aChildIsSentOnlyForATypeThatNeedsOne() {
        assertEquals("k1", leaveChildId(childcare, "k1", kids))
        // Chosen for childcare, then the type changed to annual leave: no child is sent.
        assertNull(leaveChildId(halfDays, "k1", kids))
        // Not one of the employee's children (another employee's, or since removed).
        assertNull(leaveChildId(childcare, "k9", kids))
        assertNull(leaveChildId(childcare, null, kids))
        // Children not loaded yet: wait.
        assertNull(leaveChildId(childcare, "k1", null))
    }

    @Test fun theFormSaysWhatIsMissingBeforeSending() {
        assertEquals("Choose a leave type.", leaveFormProblem(null, null, false, null))
        assertEquals("Choose the child this leave is for.", leaveFormProblem(childcare, null, false, true))
        assertNull(leaveFormProblem(childcare, "k1", false, true))
        val mc = LeaveType("t4", "sick_outpatient", "Sick leave", attachment = "required", attachmentLabel = "your medical certificate")
        assertEquals("Attach your medical certificate (take a photo or choose a file).", leaveFormProblem(mc, null, false, true))
        assertEquals("Fix the problems above before sending.", leaveFormProblem(halfDays, null, false, false))
        assertNull(leaveFormProblem(halfDays, null, false, null))
    }

    @Test fun childrenAreNamedWithTheirBirthDate() {
        assertEquals("Tan Yu Xuan · born 3 Nov 2026", childLabel(kids[0]))
        assertEquals("Tan Yu Ming · due 1 Feb 2027", childLabel(kids[1]))
        assertEquals("Ali", childLabel(LeaveChild("k3", "Ali")))
    }

    @Test fun aRequestForAChildSendsItsIdAndOlderShapesStillDecode() {
        val body = CrowJson.encodeToString(LeaveApplication.serializer(), LeaveApplication("t3", "2026-11-16", "2026-11-16", childId = "k1"))
        assertTrue(body, body.contains("\"childId\":\"k1\""))
        // Without a child the field is left out, as before (older servers never see it).
        val plain = CrowJson.encodeToString(LeaveQuoteRequest.serializer(), LeaveQuoteRequest("t1", "2026-11-16", "2026-11-16"))
        assertFalse(plain, plain.contains("childId"))
        val request = CrowJson.decodeFromString(
            LeaveRequest.serializer(),
            """{"id":"r1","employee":{"id":"e1","name":"Tan Wei Ming"},"type":{"id":"t3","name":"Childcare leave","code":"childcare"},
               "startDate":"2026-11-16","endDate":"2026-11-16","status":"pending","child":{"id":"k1","name":"Tan Yu Xuan"}}""",
        )
        assertEquals("Tan Yu Xuan", request.child!!.name)
    }

    @Test fun convertedPhotosAreNamedJpg() {
        assertEquals("IMG_2041.jpg", Attachments.jpegName("IMG_2041.HEIC"))
        assertEquals("mc 12 Nov.jpg", Attachments.jpegName("mc 12 Nov.png"))
        assertEquals("scan.jpg", Attachments.jpegName("scan"))
        assertEquals("photo.jpg", Attachments.jpegName(".heic"))
    }

    @Test fun documentsAboveTheServersLimitAreRefusedWithoutReadingThemWhole() {
        // The server refuses more than 5 MB per file (ATTACHMENT_MAX_BYTES).
        assertEquals(5L * 1024 * 1024, Attachments.MAX_BYTES)
        val small = ByteArray(1_000) { it.toByte() }
        assertArrayEquals(small, Attachments.readAtMost(ByteArrayInputStream(small), max = 1_000))
        try {
            Attachments.readAtMost(ByteArrayInputStream(ByteArray(1_001)), max = 1_000)
            fail("expected the file to be refused")
        } catch (e: AttachmentException) {
            assertEquals(Attachments.TOO_LARGE, e.message)
        }
    }
}
