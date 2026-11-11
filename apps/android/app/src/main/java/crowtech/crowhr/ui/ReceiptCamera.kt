package crowtech.crowhr.ui

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.FileProvider
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.UUID

/** Takes a receipt photo. The UI tests replace it with a stub that returns a generated image. */
interface ReceiptCamera {
    /** Returns a function that starts a capture; [onResult] gets the photo file or null. */
    @Composable
    fun rememberCapture(onResult: (File?) -> Unit): () -> Unit
}

/** The phone's own camera app (ACTION_IMAGE_CAPTURE) writing into cache/receipts via FileProvider. */
object SystemReceiptCamera : ReceiptCamera {
    @Composable
    override fun rememberCapture(onResult: (File?) -> Unit): () -> Unit {
        val context = LocalContext.current
        // One file per form field, named in the saved state: the camera app may outlive this
        // process, and two claim lines never write into the same file.
        val name = rememberSaveable { "receipt-${UUID.randomUUID()}.jpg" }
        val target = remember(name) { File(File(context.cacheDir, "receipts").apply { mkdirs() }, name) }
        val uri: Uri = remember(target) { FileProvider.getUriForFile(context, "${context.packageName}.files", target) }
        val take = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
            onResult(if (ok && target.length() > 0) target else null)
        }
        val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) take.launch(uri) else onResult(null)
        }
        return {
            if (context.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) take.launch(uri)
            else permission.launch(Manifest.permission.CAMERA)
        }
    }
}

object Images {
    /** Shrinks a photo to at most [maxSide] px and re-encodes it as JPEG (receipts stay legible, uploads stay small). */
    fun compressForUpload(file: File, maxSide: Int = 2000, quality: Int = 85): ByteArray {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.path, bounds)
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) sample *= 2
        val bitmap = BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample })
            ?: return file.readBytes()
        val scale = maxSide.toFloat() / maxOf(bitmap.width, bitmap.height)
        val scaled = if (scale < 1f) Bitmap.createScaledBitmap(bitmap, (bitmap.width * scale).toInt(), (bitmap.height * scale).toInt(), true) else bitmap
        return ByteArrayOutputStream().also { scaled.compress(Bitmap.CompressFormat.JPEG, quality, it) }.toByteArray()
    }

    fun clearTemp(context: Context) {
        File(context.cacheDir, "receipts").deleteRecursively()
        File(context.cacheDir, "share").deleteRecursively()
    }
}
