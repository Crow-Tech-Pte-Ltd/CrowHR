package crowtech.crowhr

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.media.ExifInterface
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import crowtech.crowhr.ui.Images
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * Receipt photos are uploaded upright: a camera app's landscape pixels with "rotate 90" in EXIF
 * become a portrait JPEG, and large photos are shrunk to at most 2000 px.
 */
@RunWith(AndroidJUnit4::class)
class UprightPhotoTest {
    private val dir = File(InstrumentationRegistry.getInstrumentation().targetContext.cacheDir, "upright-test").apply { mkdirs() }

    private fun photo(width: Int, height: Int, orientation: Int): File {
        // Left half red, right half blue, so a turn is visible in the pixels too.
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        Canvas(bitmap).apply {
            drawColor(Color.BLUE)
            drawRect(0f, 0f, width / 2f, height.toFloat(), Paint().apply { color = Color.RED })
        }
        val file = File(dir, "p-$orientation-$width.jpg")
        file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 95, it) }
        ExifInterface(file.path).apply { setAttribute(ExifInterface.TAG_ORIENTATION, orientation.toString()); saveAttributes() }
        return file
    }

    private fun decode(bytes: ByteArray) = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)

    @Test fun aPhotoTaggedRotate90IsUploadedPortrait() {
        val out = decode(Images.compressForUpload(photo(400, 300, ExifInterface.ORIENTATION_ROTATE_90)))
        assertEquals(300, out.width)
        assertEquals(400, out.height)
        // Turned clockwise: the red left half is now the top half.
        assertTrue(Color.red(out.getPixel(150, 20)) > 200)
        assertTrue(Color.blue(out.getPixel(150, 380)) > 200)
    }

    @Test fun anUprightPhotoKeepsItsShapeAndALargeOneIsShrunk() {
        val same = decode(Images.compressForUpload(photo(400, 300, ExifInterface.ORIENTATION_NORMAL)))
        assertEquals(400, same.width)
        assertEquals(300, same.height)
        val large = decode(Images.compressForUpload(photo(3000, 1000, ExifInterface.ORIENTATION_ROTATE_270)))
        assertEquals(2000, maxOf(large.width, large.height))
        assertTrue("portrait after turning", large.height > large.width)
        dir.deleteRecursively()
    }
}
