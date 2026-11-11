package crowtech.crowhr.ui

import crowtech.crowhr.api.LeaveType
import crowtech.crowhr.ui.screens.leaveSessions
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
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
