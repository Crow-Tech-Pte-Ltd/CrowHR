package crowtech.crowhr

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import crowtech.crowhr.connect.ConnectScreen
import crowtech.crowhr.connect.ConnectViewModel
import crowtech.crowhr.connect.DeepLinks
import crowtech.crowhr.ui.theme.CrowTheme
import kotlinx.coroutines.flow.MutableStateFlow

class MainActivity : ComponentActivity() {
    private val links = MutableStateFlow<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        handle(intent)
        val graph = AppGraph.get(this)
        setContent {
            CrowTheme {
                Surface(Modifier.fillMaxSize()) {
                    val vm: ConnectViewModel = viewModel { ConnectViewModel(graph.connectCheck, graph.connections) }
                    var connected by remember { mutableStateOf(graph.connections.active()) }
                    Column(Modifier.safeDrawingPadding().verticalScroll(rememberScrollState()).padding(16.dp)) {
                        val c = connected
                        if (c == null) ConnectScreen(vm, onConnected = { connected = it }) else Text("Connected to ${c.displayName}")
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    private fun handle(intent: Intent?) {
        val data = intent?.dataString ?: return
        if (!DeepLinks.isOAuthRedirect(data)) links.value = data
    }
}
