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
 * network, and a refresh with new items posts one local notification whose text is only a count.
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

    @Test fun periodicRefreshIsScheduledEvery15MinutesWithNetwork() {
        RefreshScheduler.schedule(context)
        val infos = WorkManager.getInstance(context).getWorkInfosForUniqueWork(RefreshSchedule.spec().uniqueName).get(10, TimeUnit.SECONDS)
        val info = infos.single { it.state == WorkInfo.State.ENQUEUED || it.state == WorkInfo.State.RUNNING }
        assertEquals(TimeUnit.MINUTES.toMillis(15), info.periodicityInfo!!.repeatIntervalMillis)
        assertEquals(NetworkType.CONNECTED, info.constraints.requiredNetworkType)
    }

    @Test fun newItemsPostOneContentFreeNotification() = runBlocking {
        graph.settings.setRefreshCursor(connection.key, "2026-11-02T01:00:00.000Z")
        val items = listOf(
            AppNotification(id = "n2", category = "approvals", title = "Nadia Rahman asked for annual leave on 9 Nov", body = "1 day", createdAt = "2026-11-02T03:15:00.000Z"),
            AppNotification(id = "n1", category = "approvals", title = "Old", createdAt = "2026-11-02T01:00:00.000Z"),
        )
        assertTrue(RefreshRunner(graph) { items }.run())
        val posted = manager.activeNotifications.single { it.id == Notifications.ID }
        val extras = posted.notification.extras
        assertEquals("Crow HR", extras.getCharSequence(Notification.EXTRA_TITLE).toString())
        assertEquals("You have 1 new item in Crow HR", extras.getCharSequence(Notification.EXTRA_TEXT).toString())
        // Nothing else that could carry personal data.
        assertNull(extras.getCharSequence(Notification.EXTRA_BIG_TEXT))
        assertNull(extras.getCharSequence(Notification.EXTRA_SUB_TEXT))
        assertNull(extras.getCharSequence(Notification.EXTRA_INFO_TEXT))
        val all = extras.keySet().joinToString { extras.get(it).toString() }
        assertFalse(all.contains("Nadia") || all.contains("annual"))
        assertEquals(Notification.VISIBILITY_PUBLIC, posted.notification.visibility)
        assertEquals("2026-11-02T03:15:00.000Z", graph.settings.refreshCursor(connection.key))
    }

    @Test fun nothingNewPostsNothing() = runBlocking {
        graph.settings.setRefreshCursor(connection.key, "2026-11-02T04:00:00.000Z")
        RefreshRunner(graph) { listOf(AppNotification(id = "n4", title = "x", createdAt = "2026-11-02T04:00:00.000Z")) }.run()
        assertTrue(manager.activeNotifications.none { it.id == Notifications.ID })
    }

    @Test fun turnedOffPostsNothing() = runBlocking {
        graph.settings.notificationsEnabled = false
        graph.settings.setRefreshCursor(connection.key, "2026-11-02T01:00:00.000Z")
        RefreshRunner(graph) { listOf(AppNotification(id = "n5", title = "x", createdAt = "2026-11-02T06:00:00.000Z")) }.run()
        assertTrue(manager.activeNotifications.none { it.id == Notifications.ID })
        assertEquals("2026-11-02T06:00:00.000Z", graph.settings.refreshCursor(connection.key))
    }
}
