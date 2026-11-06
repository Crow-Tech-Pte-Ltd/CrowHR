package crowtech.crowhr

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.work.NetworkType
import androidx.work.WorkInfo
import androidx.work.WorkManager
import crowtech.crowhr.api.AppNotification
import crowtech.crowhr.api.NotificationPage
import crowtech.crowhr.auth.StoredTokens
import crowtech.crowhr.connect.MetaSignInMethod
import crowtech.crowhr.connect.SavedConnection
import crowtech.crowhr.notify.Notifications
import crowtech.crowhr.notify.RefreshRunner
import crowtech.crowhr.notify.RefreshSchedule
import crowtech.crowhr.notify.RefreshScheduler
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.TimeUnit

/**
 * Task 2.6 on a device: WorkManager holds a periodic refresh of at least 15 minutes that needs a
 * network; a refresh with new items posts one local notification whose text is only a count.
 * Covers servers with the `since` cursor and older ones without it.
 */
@RunWith(AndroidJUnit4::class)
class BackgroundRefreshWorkerTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val graph = AppGraph.get(context)
    private val manager = context.getSystemService(NotificationManager::class.java)
    private val connection = SavedConnection(
        server = "https://hr.example.com", orgSlug = "acme", displayName = "Acme Pte. Ltd.",
        signInMethods = listOf(MetaSignInMethod("password", "Email and password")),
    )
    private val requests = mutableListOf<Map<String, String?>>()

    @Before fun setUp() {
        graph.resetForTests()
        instrumentation.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.POST_NOTIFICATIONS)
        manager.cancelAll()
        graph.connections.add(connection)
        graph.tokens.put(connection.key, StoredTokens("not-used", "not-used", "device"))
    }

    @After fun tearDown() {
        manager.cancelAll()
        RefreshScheduler.cancel(context)
        graph.resetForTests()
    }

    /** A fake server: [pages] answers by `since` (null key = no `since`). */
    private fun runner(pages: Map<String?, NotificationPage>) = RefreshRunner(graph) { _, query ->
        requests += query
        pages[query["since"]] ?: error("unexpected query $query")
    }

    private fun page(cursor: String?, vararg items: AppNotification) = NotificationPage(items.toList(), cursor = cursor)

    private val approval = AppNotification(
        id = "n2", category = "approvals", title = "Nadia Rahman asked for annual leave on 9 Nov", body = "1 day",
        createdAt = "2026-11-02T03:15:00.000Z",
    )

    /** notify() is asynchronous: give the notification manager a moment to list it. */
    private fun posted(): android.service.notification.StatusBarNotification? {
        repeat(25) {
            manager.activeNotifications.singleOrNull { it.id == Notifications.ID }?.let { return it }
            Thread.sleep(200)
        }
        return null
    }

    @Test fun periodicRefreshIsScheduledEvery15MinutesWithNetwork() {
        RefreshScheduler.schedule(context)
        val infos = WorkManager.getInstance(context).getWorkInfosForUniqueWork(RefreshSchedule.spec().uniqueName).get(10, TimeUnit.SECONDS)
        val info = infos.single { it.state == WorkInfo.State.ENQUEUED || it.state == WorkInfo.State.RUNNING }
        assertEquals(TimeUnit.MINUTES.toMillis(15), info.periodicityInfo!!.repeatIntervalMillis)
        assertEquals(NetworkType.CONNECTED, info.constraints.requiredNetworkType)
    }

    @Test fun serverCursorNewItemsPostOneContentFreeNotification() = runBlocking {
        graph.settings.setRefreshCursor(connection.key, "srv:A")
        assertTrue(runner(mapOf("A" to page("B", approval), "B" to page("B"))).run())
        assertEquals(listOf("A", "B"), requests.map { it["since"] })
        val n = posted()!!.notification
        val extras = n.extras
        assertEquals("Crow HR", extras.getCharSequence(Notification.EXTRA_TITLE).toString())
        assertEquals("You have 1 new item in Crow HR", extras.getCharSequence(Notification.EXTRA_TEXT).toString())
        // Nothing else that could carry personal data.
        assertNull(extras.getCharSequence(Notification.EXTRA_BIG_TEXT))
        assertNull(extras.getCharSequence(Notification.EXTRA_SUB_TEXT))
        assertNull(extras.getCharSequence(Notification.EXTRA_INFO_TEXT))
        val all = extras.keySet().joinToString { extras.get(it).toString() }
        assertFalse(all.contains("Nadia") || all.contains("annual"))
        assertEquals(Notification.VISIBILITY_PUBLIC, n.visibility)
        assertEquals("srv:B", graph.settings.refreshCursor(connection.key))
    }

    @Test fun firstRefreshAfterSignInOnlySetsTheCursor() = runBlocking {
        runner(mapOf(null to page("X", approval))).run()
        assertNull(posted())
        assertEquals("srv:X", graph.settings.refreshCursor(connection.key))
    }

    @Test fun serverCursorNothingNewPostsNothing() = runBlocking {
        graph.settings.setRefreshCursor(connection.key, "srv:A")
        runner(mapOf("A" to page("A"))).run()
        assertNull(posted())
        assertEquals("srv:A", graph.settings.refreshCursor(connection.key))
    }

    @Test fun olderServerWithoutCursorUsesCreatedAt() = runBlocking {
        graph.settings.setRefreshCursor(connection.key, "2026-11-02T01:00:00.000Z")
        val legacy = NotificationPage(listOf(approval))
        runner(mapOf(null to legacy)).run()
        assertEquals("You have 1 new item in Crow HR", posted()!!.notification.extras.getCharSequence(Notification.EXTRA_TEXT).toString())
        assertEquals("2026-11-02T03:15:00.000Z", graph.settings.refreshCursor(connection.key))
    }

    @Test fun turnedOffPostsNothingButMovesOn() = runBlocking {
        graph.settings.notificationsEnabled = false
        graph.settings.setRefreshCursor(connection.key, "srv:A")
        runner(mapOf("A" to page("C", approval), "C" to page("C"))).run()
        assertNull(posted())
        assertEquals("srv:C", graph.settings.refreshCursor(connection.key))
    }
}
