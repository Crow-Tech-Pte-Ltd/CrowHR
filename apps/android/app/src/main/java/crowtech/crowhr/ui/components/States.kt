package crowtech.crowhr.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableIntState
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import crowtech.crowhr.api.ApiException
import crowtech.crowhr.api.OfflineException
import crowtech.crowhr.ui.theme.Crow

/** Every screen's data: loading, empty, error, offline and ready (spec "Feature scope"). */
sealed interface LoadState<out T> {
    data object Loading : LoadState<Nothing>
    data class Ready<T>(val value: T, val offlineSince: String? = null) : LoadState<T>
    data class Failed(val message: String, val offline: Boolean) : LoadState<Nothing>
}

fun Throwable.userMessage(): String = when (this) {
    is OfflineException -> message ?: "You're offline. Connect to the internet and try again."
    is ApiException -> message
    else -> "Something went wrong. Try again."
}

class Loader<T>(val state: MutableState<LoadState<T>>, private val reloadKey: MutableIntState) {
    val value: LoadState<T> get() = state.value
    fun reload() { reloadKey.intValue++ }
}

/**
 * Loads [block] when the screen opens and on [Loader.reload]. When [cached] returns a saved copy
 * and the network fails with [OfflineException], the saved copy is shown with an offline note.
 */
@Composable
fun <T> rememberLoader(
    vararg keys: Any?,
    cached: (suspend () -> Pair<T, String>?)? = null,
    block: suspend () -> T,
): Loader<T> {
    val state = remember(*keys) { mutableStateOf<LoadState<T>>(LoadState.Loading) }
    val reload = remember(*keys) { mutableIntStateOf(0) }
    LaunchedEffect(*keys, reload.intValue) {
        if (state.value !is LoadState.Ready) state.value = LoadState.Loading
        state.value = try {
            LoadState.Ready(block())
        } catch (e: OfflineException) {
            val saved = cached?.invoke()
            if (saved != null) LoadState.Ready(saved.first, offlineSince = saved.second) else LoadState.Failed(e.userMessage(), true)
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            LoadState.Failed(e.userMessage(), false)
        }
    }
    return remember(*keys) { Loader(state, reload) }
}

@Composable
fun LoadingState(label: String, modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxWidth().padding(vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        CircularProgressIndicator(strokeWidth = 2.dp, color = Crow.colors.ink)
        Text(label, style = MaterialTheme.typography.bodyMedium, color = Crow.colors.muted)
    }
}

@Composable
fun EmptyState(title: String, body: String, modifier: Modifier = Modifier, action: (@Composable () -> Unit)? = null) {
    Column(
        modifier.fillMaxWidth().padding(vertical = 40.dp, horizontal = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(title, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        Text(body, style = MaterialTheme.typography.bodyMedium, color = Crow.colors.muted, textAlign = TextAlign.Center)
        action?.invoke()
    }
}

@Composable
fun ErrorState(message: String, offline: Boolean, onRetry: () -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxWidth().padding(vertical = 24.dp).semantics { liveRegion = LiveRegionMode.Polite },
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Notice(message, if (offline) Tone.Warning else Tone.Danger, title = if (offline) "You're offline" else "Couldn't load this")
        SecondaryButton("Try again", onRetry, Modifier.fillMaxWidth())
    }
}

@Composable
fun OfflineNote(savedAt: String, modifier: Modifier = Modifier) {
    Notice("Showing what was saved on this phone at $savedAt. Pull to refresh when you're back online.", Tone.Warning, modifier, title = "You're offline")
}

/** Renders a [Loader] with the shared loading / error states; [content] gets the value. */
@Composable
fun <T> LoadContent(
    loader: Loader<T>,
    loadingLabel: String,
    content: @Composable (T) -> Unit,
) {
    when (val s = loader.value) {
        LoadState.Loading -> LoadingState(loadingLabel)
        is LoadState.Failed -> ErrorState(s.message, s.offline, loader::reload)
        is LoadState.Ready -> Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (s.offlineSince != null) OfflineNote(s.offlineSince)
            content(s.value)
        }
    }
}

@Composable
fun rememberFlag(initial: Boolean = false) = remember { mutableStateOf(initial) }

@Composable
fun FieldError(message: String?) {
    if (message != null) {
        Text(message, style = MaterialTheme.typography.bodySmall, color = Crow.colors.danger, modifier = Modifier.padding(top = 4.dp).semantics { liveRegion = LiveRegionMode.Polite })
    }
}
