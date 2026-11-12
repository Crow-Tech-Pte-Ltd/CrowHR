package crowtech.crowhr.api

import crowtech.crowhr.core.CrowJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/** Marking one notification read updates the list in place instead of fetching all 50 again. */
class NotificationPageTest {
    private val page = CrowJson.decodeFromString(
        NotificationPage.serializer(),
        """{"items":[
            {"id":"n1","title":"A","createdAt":"2026-11-07T01:00:00.000Z","readAt":null},
            {"id":"n2","title":"B","createdAt":"2026-11-07T00:00:00.000Z","readAt":"2026-11-07T02:00:00.000Z"}
           ],"total":2,"unread":1,"cursor":"c2"}""",
    )

    @Test fun markingOneReadChangesThatRowAndTheCount() {
        val read = page.markingRead("n1", "2026-11-07T03:00:00Z")
        assertEquals(listOf("2026-11-07T03:00:00Z", "2026-11-07T02:00:00.000Z"), read.items.map { it.readAt })
        assertEquals(0, read.unread)
        assertEquals("c2", read.cursor)
        assertTrue(read.supportsCursor)
    }

    @Test fun anAlreadyReadOrMissingNotificationChangesNothing() {
        assertSame(page, page.markingRead("n2", "x"))
        assertSame(page, page.markingRead("n9", "x"))
        assertEquals(0, page.copy(unread = 0).markingRead("n1", "x").unread)
    }

    @Test fun olderServersStillHaveNoCursor() {
        val old = CrowJson.decodeFromString(NotificationPage.serializer(), """{"items":[],"total":0,"unread":0}""")
        assertFalse(old.supportsCursor)
    }
}
