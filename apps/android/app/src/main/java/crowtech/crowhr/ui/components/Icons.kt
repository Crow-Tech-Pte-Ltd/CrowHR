package crowtech.crowhr.ui.components

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp

/**
 * A handful of 24-grid line icons drawn for this app (consistent 1.75 stroke, round caps), so no
 * icon library is bundled. Tinted by the caller.
 */
object CrowIcons {
    private fun icon(name: String, vararg paths: String): ImageVector {
        val b = ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f)
        for (p in paths) {
            b.addPath(
                pathData = PathParser().parsePathString(p).toNodes(),
                fill = null,
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 1.75f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            )
        }
        return b.build()
    }

    val Clock = icon("clock", "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z", "M12 7v5l3 2")
    val Calendar = icon("calendar", "M4 6h16v14H4z", "M4 10h16", "M8 3v4", "M16 3v4")
    val Payslip = icon("payslip", "M6 3h9l3 3v15H6z", "M9 9h6", "M9 13h6", "M9 17h4")
    val Tasks = icon("tasks", "M4 4h16v16H4z", "M8 12l3 3l5-6")
    val More = icon("more", "M4 7h16", "M4 12h16", "M4 17h16")
    val Back = icon("back", "M15 5l-7 7l7 7")
    val Chevron = icon("chevron", "M9 5l7 7l-7 7")
    val Camera = icon("camera", "M4 8h3l2-3h6l2 3h3v11H4z", "M12 10a3 3 0 1 0 0 6a3 3 0 1 0 0-6z")
    val Plus = icon("plus", "M12 5v14", "M5 12h14")
}
