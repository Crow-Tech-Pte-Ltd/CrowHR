package crowtech.crowhr.connect

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.unit.dp
import crowtech.crowhr.api.HttpClients
import crowtech.crowhr.ui.theme.Crow
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Request

/**
 * The organisation's logo from meta, fetched only from the organisation's own server (a logo URL
 * on any other host is ignored, so connecting never contacts a third party). Initials otherwise.
 */
@Composable
fun OrganisationLogo(server: String, logoUrl: String?, name: String, modifier: Modifier = Modifier) {
    val bitmap by produceState<ImageBitmap?>(null, server, logoUrl) {
        value = loadLogo(server, logoUrl)
    }
    val shape = RoundedCornerShape(6.dp)
    Box(modifier.size(48.dp).border(1.dp, Crow.colors.hairline, shape).background(MaterialTheme.colorScheme.surface, shape), contentAlignment = Alignment.Center) {
        val b = bitmap
        if (b != null) {
            Image(b, contentDescription = "$name logo", modifier = Modifier.size(40.dp))
        } else {
            val initials = name.split(' ').filter { it.firstOrNull()?.isLetter() == true }.take(2).joinToString("") { it.first().uppercase() }
            Text(initials, style = MaterialTheme.typography.titleMedium)
        }
    }
}

private suspend fun loadLogo(server: String, logoUrl: String?): ImageBitmap? = withContext(Dispatchers.IO) {
    val serverUrl = server.toHttpUrlOrNull() ?: return@withContext null
    val url = logoUrl?.toHttpUrlOrNull() ?: return@withContext null
    if (url.host != serverUrl.host) return@withContext null
    runCatching {
        HttpClients.forHost(serverUrl.host).newCall(Request.Builder().url(url).build()).execute().use { r ->
            if (!r.isSuccessful) return@use null
            val bytes = r.body?.bytes() ?: return@use null
            if (bytes.size > 1_000_000) return@use null
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
        }
    }.getOrNull()
}
