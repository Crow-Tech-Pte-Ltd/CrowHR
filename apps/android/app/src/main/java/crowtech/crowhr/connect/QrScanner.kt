package crowtech.crowhr.connect

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.MultiFormatReader
import com.google.zxing.NotFoundException
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer
import crowtech.crowhr.ui.components.Notice
import crowtech.crowhr.ui.components.SecondaryButton
import crowtech.crowhr.ui.components.Tone
import crowtech.crowhr.ui.theme.Crow
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * On-device QR scanning: CameraX preview + ZXing decoding of the luminance plane. Nothing is
 * sent anywhere; the decoded text goes to [onResult] once.
 */
@Composable
fun QrScanner(onResult: (String) -> Unit, onCancel: () -> Unit) {
    val context = LocalContext.current
    var granted by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
    }
    var denied by remember { mutableStateOf(false) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        granted = ok
        denied = !ok
    }
    LaunchedEffect(Unit) { if (!granted) launcher.launch(Manifest.permission.CAMERA) }
    // Back from system settings with the camera allowed: start scanning without another tap.
    LifecycleResumeEffect(Unit) {
        if (!granted && ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            granted = true
            denied = false
        }
        onPauseOrDispose { }
    }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        when {
            granted -> CameraPreview(onResult)
            denied -> {
                Notice(
                    "Crow HR needs the camera only to read the QR code, on this phone. You can allow it in Settings, or enter the address instead.",
                    Tone.Warning,
                    title = "Camera not allowed",
                )
                SecondaryButton("Open Settings", {
                    runCatching {
                        context.startActivity(
                            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)),
                        )
                    }
                }, Modifier.fillMaxWidth())
            }
        }
        Text(
            "In Crow HR on the web, open My profile → Mobile app and point the camera at the code.",
            style = MaterialTheme.typography.bodyMedium,
            color = Crow.colors.muted,
        )
        SecondaryButton("Enter the address instead", onCancel, Modifier.fillMaxWidth())
    }
}

@Composable
private fun CameraPreview(onResult: (String) -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val done = remember { AtomicBoolean(false) }
    val executor = remember { Executors.newSingleThreadExecutor() }
    val previewView = remember { PreviewView(context).apply { scaleType = PreviewView.ScaleType.FILL_CENTER } }
    DisposableEffect(lifecycleOwner) {
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            val provider = future.get()
            val preview = Preview.Builder().build().also { it.surfaceProvider = previewView.surfaceProvider }
            val analysis = ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()
            val reader = MultiFormatReader().apply {
                setHints(mapOf(DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE), DecodeHintType.TRY_HARDER to true))
            }
            analysis.setAnalyzer(executor) { image ->
                val text = decode(reader, image)
                image.close()
                if (text != null && done.compareAndSet(false, true)) {
                    ContextCompat.getMainExecutor(context).execute { onResult(text) }
                }
            }
            runCatching {
                provider.unbindAll()
                provider.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
            }
        }, ContextCompat.getMainExecutor(context))
        onDispose {
            runCatching { future.get().unbindAll() }
            executor.shutdown()
        }
    }
    Box(
        Modifier
            .fillMaxWidth()
            .aspectRatio(1f)
            .border(2.dp, Crow.colors.ink, RoundedCornerShape(8.dp))
            .semantics { contentDescription = "Camera view for scanning the Crow HR QR code" },
    ) {
        AndroidView({ previewView }, Modifier.fillMaxWidth().aspectRatio(1f))
    }
}

private fun decode(reader: MultiFormatReader, image: ImageProxy): String? {
    val plane = image.planes.firstOrNull() ?: return null
    val buffer = plane.buffer
    val bytes = ByteArray(buffer.remaining()).also { buffer.get(it) }
    val source = PlanarYUVLuminanceSource(bytes, plane.rowStride, image.height, 0, 0, image.width, image.height, false)
    return try {
        reader.decodeWithState(BinaryBitmap(HybridBinarizer(source))).text
    } catch (_: NotFoundException) {
        null
    } catch (_: Exception) {
        null
    } finally {
        reader.reset()
    }
}
