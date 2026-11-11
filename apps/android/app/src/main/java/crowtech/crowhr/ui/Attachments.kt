package crowtech.crowhr.ui

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import crowtech.crowhr.api.LeaveAttachment
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.util.UUID

/** A file that can't be attached; [message] says how to fix it. */
class AttachmentException(message: String) : Exception(message)

/**
 * Leave attachments (a medical certificate, say): a photo from the camera or a document the user
 * picks. Photos are shrunk and re-encoded as JPEG like receipts; documents keep their name.
 */
object Attachments {
    /** The server's limit per file: packages/core/src/leave/service.ts ATTACHMENT_MAX_BYTES. */
    const val MAX_BYTES: Long = 5L * 1024 * 1024
    const val TOO_LARGE = "Choose a file of 5 MB or less, or take a photo of the document instead."
    const val UNREADABLE = "Couldn't read that file. Try another one."

    /** What the server accepts (PDF and photos); HEIF photos are converted to JPEG here. */
    val TYPES = arrayOf("application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif")

    /** "IMG_2041.HEIC" → "IMG_2041.jpg": the name of a photo once converted. */
    fun jpegName(name: String): String = name.substringBeforeLast('.').trim().ifEmpty { "photo" } + ".jpg"

    /** The whole stream, or [AttachmentException] as soon as it passes [max] bytes (never all of a huge file in memory). */
    fun readAtMost(input: InputStream, max: Long = MAX_BYTES): ByteArray {
        val out = ByteArrayOutputStream()
        val buffer = ByteArray(64 * 1024)
        var total = 0L
        while (true) {
            val n = input.read(buffer)
            if (n < 0) break
            total += n
            if (total > max) throw AttachmentException(TOO_LARGE)
            out.write(buffer, 0, n)
        }
        return out.toByteArray()
    }

    /** A camera photo (or a picked image), shrunk and upright. Call off the main thread. */
    fun photo(file: File, name: String): LeaveAttachment {
        val bytes = Images.compressForUpload(file)
        if (bytes.size > MAX_BYTES) throw AttachmentException(TOO_LARGE)
        return LeaveAttachment(name, "image/jpeg", Base64.encodeToString(bytes, Base64.NO_WRAP))
    }

    /** A document from the system picker, with its real file name. Call off the main thread. */
    fun fromDocument(context: Context, uri: Uri): LeaveAttachment {
        val resolver = context.contentResolver
        var name = "attachment"
        var size: Long? = null
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
            if (c.moveToFirst()) {
                c.getColumnIndex(OpenableColumns.DISPLAY_NAME).takeIf { it >= 0 && !c.isNull(it) }?.let { name = c.getString(it) }
                c.getColumnIndex(OpenableColumns.SIZE).takeIf { it >= 0 && !c.isNull(it) }?.let { size = c.getLong(it) }
            }
        }
        val mime = resolver.getType(uri) ?: "application/octet-stream"
        if (mime.startsWith("image/")) {
            val temp = File(File(context.cacheDir, "receipts").apply { mkdirs() }, "pick-${UUID.randomUUID()}")
            try {
                resolver.openInputStream(uri)?.use { input -> temp.outputStream().use { input.copyTo(it) } }
                    ?: throw AttachmentException(UNREADABLE)
                return photo(temp, jpegName(name))
            } finally {
                temp.delete()
            }
        }
        if ((size ?: 0) > MAX_BYTES) throw AttachmentException(TOO_LARGE)
        val bytes = resolver.openInputStream(uri)?.use { readAtMost(it) } ?: throw AttachmentException(UNREADABLE)
        return LeaveAttachment(name, mime, Base64.encodeToString(bytes, Base64.NO_WRAP))
    }
}
