package crowtech.crowhr

import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import crowtech.crowhr.connect.DeepLinks
import crowtech.crowhr.notify.Notifications
import crowtech.crowhr.ui.AppRoot
import crowtech.crowhr.ui.AppViewModel
import crowtech.crowhr.ui.Images
import crowtech.crowhr.ui.OpenRequest
import crowtech.crowhr.ui.theme.CrowTheme

class MainActivity : ComponentActivity() {
    private val graph by lazy { AppGraph.get(this) }
    private val vm: AppViewModel by viewModels {
        object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T = AppViewModel(graph) as T
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        // The app switcher shows a blank card instead of payslips or personal details.
        if (Build.VERSION.SDK_INT >= 33) setRecentsScreenshotEnabled(false)
        if (savedInstanceState == null) {
            Images.clearTemp(this)
            handle(intent)
        }
        setContent {
            CrowTheme {
                Surface(Modifier.fillMaxSize().semantics { testTagsAsResourceId = true }) {
                    AppRoot(graph, vm)
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    override fun onStart() {
        super.onStart()
        vm.onForeground()
    }

    override fun onResume() {
        super.onResume()
        vm.onResumed()
    }

    override fun onStop() {
        super.onStop()
        vm.onBackground()
    }

    private fun handle(intent: Intent?) {
        intent?.getStringExtra(Notifications.EXTRA_OPEN)?.let { inbox ->
            vm.onOpenRequest(
                OpenRequest(
                    inbox = inbox,
                    link = intent.getStringExtra(Notifications.EXTRA_LINK),
                    connectionKey = intent.getStringExtra(Notifications.EXTRA_CONNECTION),
                    notificationId = intent.getStringExtra(Notifications.EXTRA_NOTIFICATION),
                ),
            )
        }
        val data = intent?.dataString ?: return
        if (DeepLinks.isOAuthRedirect(data)) vm.onRedirect(data) else vm.onConnectLink(data)
    }
}
