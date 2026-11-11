package crowtech.crowhr.ui

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
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
    /**
     * Returns a function that starts a capture; [onResult] gets the photo file, or null when the
     * user cancelled. [onError] says why no photo can be taken (camera not allowed, no camera app).
     */
    @Composable
    fun rememberCapture(onError: (String) -> Unit = {}, onResult: (File?) -> Unit): () -> Unit

    companion object {
        const val NOT_ALLOWED = "Crow HR isn't allowed to use the camera. Allow it in Android Settings → Apps → Crow HR → Permissions, then try again."
        const val NO_CAMERA_APP = "This phone has no camera app that Crow HR can use."
    }
}

/** The phone's own camera app (ACTION_IMAGE_CAPTURE) writing into cache/receipts via FileProvider. */
object SystemReceiptCamera : ReceiptCamera {
    @Composable
    override fun rememberCapture(onError: (String) -> Unit, onResult: (File?) -> Unit): () -> Unit {
        val context = LocalContext.current
        // One file per form field, named in the saved state: the camera app may outlive this
        // process, and two claim lines never write into the same file.
        val name = rememberSaveable { "receipt-${UUID.randomUUID()}.jpg" }
        val target = remember(name) { File(File(context.cacheDir, "receipts").apply { mkdirs() }, name) }
        val uri: Uri = remember(target) { FileProvider.getUriForFile(context, "${context.packageName}.files", target) }
        val take = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
            onResult(if (ok && target.length() > 0) target else null)
        }
        // The app declares CAMERA (for QR codes), so Android refuses ACTION_IMAGE_CAPTURE
        // without it. Say so instead of silently doing nothing.
        fun open() = try {
            take.launch(uri)
        } catch (_: ActivityNotFoundException) {
            onError(ReceiptCamera.NO_CAMERA_APP)
        }
        val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) open() else onError(ReceiptCamera.NOT_ALLOWED)
        }
        return {
            if (context.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) open()
            else permission.launch(Manifest.permission.CAMERA)
        }
    }
}

object Images {
    /** How to turn a photo upright: rotate clockwise by [degrees], then mirror horizontally if [mirror]. */
    data class Upright(val degrees: Int, val mirror: Boolean)

    /**
     * EXIF orientation (1–8) → the transform that shows the photo upright. Camera apps usually
     * store a portrait photo as landscape pixels plus this tag; re-encoding drops the tag, so
     * the pixels themselves must be turned or the receipt arrives sideways.
     */
    fun upright(exifOrientation: Int): Upright = when (exifOrientation) {
        2 -> Upright(0, true)
        3 -> Upright(180, false)
        4 -> Upright(180, true)
        5 -> Upright(90, true)
        6 -> Upright(90, false)
        7 -> Upright(270, true)
        8 -> Upright(270, false)
        else -> Upright(0, false)
    }

    /**
     * Shrinks a photo to at most [maxSide] px, turns it upright and re-encodes it as JPEG
     * (receipts stay legible, uploads stay small, no EXIF such as location is sent). Slow for a
     * 12 MP photo: call it off the main thread.
     */
    // The framework ExifInterface: its known issues are on Android versions below minSdk 29, and
    // androidx.exifinterface would be another dependency for the Data safety audit.
    @SuppressLint("ExifInterface")
    fun compressForUpload(file: File, maxSide: Int = 2000, quality: Int = 85): ByteArray {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.path, bounds)
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) sample *= 2
        val bitmap = BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample })
            ?: return file.readBytes()
        val scale = minOf(1f, maxSide.toFloat() / maxOf(bitmap.width, bitmap.height))
        val turn = upright(runCatching { android.media.ExifInterface(file.path).getAttributeInt(android.media.ExifInterface.TAG_ORIENTATION, 1) }.getOrDefault(1))
        val out = if (scale < 1f || turn.degrees != 0 || turn.mirror) {
            val matrix = Matrix().apply {
                setScale(scale, scale)
                if (turn.degrees != 0) postRotate(turn.degrees.toFloat())
                if (turn.mirror) postScale(-1f, 1f)
            }
            Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
        } else {
            bitmap
        }
        return ByteArrayOutputStream().also { out.compress(Bitmap.CompressFormat.JPEG, quality, it) }.toByteArray()
    }

    fun clearTemp(context: Context) {
        File(context.cacheDir, "receipts").deleteRecursively()
        File(context.cacheDir, "share").deleteRecursively()
    }
}
