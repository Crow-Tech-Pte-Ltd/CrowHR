package crowtech.crowhr.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import crowtech.crowhr.R

/**
 * Crow Tech tokens (packages/ui/src/styles/globals.css, HSL converted to hex). The web has no
 * dark theme yet; the dark palette keeps the same roles: near-black surfaces, light ink,
 * kuning for primary actions and selection, biru for links and focus.
 */
object CrowTokens {
    val Surface50 = Color(0xFFFFFFFF)
    val Surface100 = Color(0xFFFDF6E8)
    val Surface200 = Color(0xFFEBEDEF)
    val Ink = Color(0xFF0A0A0A)
    val Primary200 = Color(0xFF666666)
    val Primary300 = Color(0xFF333333)
    val Border = Color(0xFFDEDEDE)
    val Input = Color(0xFFCCCCCC)
    val Kuning50 = Color(0xFFFFF2CC)
    val Kuning200 = Color(0xFFFED56C)
    val Kuning300 = Color(0xFFFEC83E)
    val Biru200 = Color(0xFF6796F4)
    val Biru400 = Color(0xFF1C5EE3)
    val Danger50 = Color(0xFFFCE8E8)
    val Danger100 = Color(0xFFE07171)
    val Danger200 = Color(0xFFC52B2B)
    val Danger300 = Color(0xFFA82424)
    val Success50 = Color(0xFFD7F4D7)
    val Success200 = Color(0xFF70D86E)
    val Success300 = Color(0xFF31922F)
    val Success400 = Color(0xFF0C6A52)
    val Warning50 = Color(0xFFFDF3E2)
    val Warning200 = Color(0xFFF1B055)
    val Warning400 = Color(0xFFA6630C)

    // Dark roles (derived).
    val NightBackground = Color(0xFF111111)
    val NightSurface = Color(0xFF171717)
    val NightSurfaceVariant = Color(0xFF232323)
    val NightInk = Color(0xFFF2F2F2)
    val NightMuted = Color(0xFFA6A6A6)
    val NightBorder = Color(0xFF333333)
}

/** Roles Material's ColorScheme has no slot for. */
@Immutable
data class CrowColors(
    val ink: Color,
    val muted: Color,
    val hairline: Color,
    val link: Color,
    val focus: Color,
    val accent: Color,
    val onAccent: Color,
    val accentSoft: Color,
    val success: Color,
    val successSoft: Color,
    val warning: Color,
    val warningSoft: Color,
    val danger: Color,
    val dangerSoft: Color,
    val shadow: Color,
)

private val LightCrow = CrowColors(
    ink = CrowTokens.Ink, muted = CrowTokens.Primary200, hairline = CrowTokens.Border,
    link = CrowTokens.Biru400, focus = CrowTokens.Biru400, accent = CrowTokens.Kuning200,
    onAccent = CrowTokens.Ink, accentSoft = CrowTokens.Kuning50,
    success = CrowTokens.Success400, successSoft = CrowTokens.Success50,
    warning = CrowTokens.Warning400, warningSoft = CrowTokens.Warning50,
    danger = CrowTokens.Danger300, dangerSoft = CrowTokens.Danger50, shadow = CrowTokens.Ink,
)

private val DarkCrow = CrowColors(
    ink = CrowTokens.NightInk, muted = CrowTokens.NightMuted, hairline = CrowTokens.NightBorder,
    link = CrowTokens.Biru200, focus = CrowTokens.Biru200, accent = CrowTokens.Kuning200,
    onAccent = CrowTokens.Ink, accentSoft = Color(0xFF3A3220),
    success = CrowTokens.Success200, successSoft = Color(0xFF15301F),
    warning = CrowTokens.Warning200, warningSoft = Color(0xFF3A2A12),
    // Light hard shadow on dark surfaces (iOS strongBorder 0xF5F5F5); black would vanish.
    danger = CrowTokens.Danger100, dangerSoft = Color(0xFF3A1717), shadow = Color(0xFFF5F5F5),
)

private val LightScheme: ColorScheme = lightColorScheme(
    primary = CrowTokens.Kuning200, onPrimary = CrowTokens.Ink,
    primaryContainer = CrowTokens.Kuning50, onPrimaryContainer = CrowTokens.Ink,
    secondary = CrowTokens.Ink, onSecondary = CrowTokens.Surface50,
    secondaryContainer = CrowTokens.Kuning200, onSecondaryContainer = CrowTokens.Ink,
    tertiary = CrowTokens.Biru400, onTertiary = CrowTokens.Surface50,
    background = CrowTokens.Surface50, onBackground = CrowTokens.Ink,
    surface = CrowTokens.Surface50, onSurface = CrowTokens.Ink,
    surfaceVariant = CrowTokens.Surface200, onSurfaceVariant = CrowTokens.Primary200,
    surfaceContainer = CrowTokens.Surface50, surfaceContainerLow = CrowTokens.Surface50,
    surfaceContainerHigh = CrowTokens.Surface50, surfaceContainerHighest = CrowTokens.Surface200,
    surfaceContainerLowest = CrowTokens.Surface50,
    outline = CrowTokens.Input, outlineVariant = CrowTokens.Border,
    error = CrowTokens.Danger300, onError = CrowTokens.Surface50,
    errorContainer = CrowTokens.Danger50, onErrorContainer = CrowTokens.Danger300,
    surfaceTint = Color.Transparent,
)

private val DarkScheme: ColorScheme = darkColorScheme(
    primary = CrowTokens.Kuning200, onPrimary = CrowTokens.Ink,
    primaryContainer = Color(0xFF3A3220), onPrimaryContainer = CrowTokens.NightInk,
    secondary = CrowTokens.NightInk, onSecondary = CrowTokens.Ink,
    secondaryContainer = CrowTokens.Kuning200, onSecondaryContainer = CrowTokens.Ink,
    tertiary = CrowTokens.Biru200, onTertiary = CrowTokens.Ink,
    background = CrowTokens.NightBackground, onBackground = CrowTokens.NightInk,
    surface = CrowTokens.NightBackground, onSurface = CrowTokens.NightInk,
    surfaceVariant = CrowTokens.NightSurfaceVariant, onSurfaceVariant = CrowTokens.NightMuted,
    surfaceContainer = CrowTokens.NightSurface, surfaceContainerLow = CrowTokens.NightSurface,
    surfaceContainerHigh = CrowTokens.NightSurface, surfaceContainerHighest = CrowTokens.NightSurfaceVariant,
    surfaceContainerLowest = CrowTokens.NightBackground,
    outline = Color(0xFF4A4A4A), outlineVariant = CrowTokens.NightBorder,
    error = CrowTokens.Danger100, onError = CrowTokens.Ink,
    errorContainer = Color(0xFF3A1717), onErrorContainer = CrowTokens.Danger100,
    surfaceTint = Color.Transparent,
)

val AzeretMono = FontFamily(
    Font(R.font.azeret_mono_regular, FontWeight.Normal),
    Font(R.font.azeret_mono_medium, FontWeight.Medium),
    Font(R.font.azeret_mono_semibold, FontWeight.SemiBold),
)

val Ubuntu = FontFamily(
    Font(R.font.ubuntu_regular, FontWeight.Normal),
    Font(R.font.ubuntu_medium, FontWeight.Medium),
    Font(R.font.ubuntu_bold, FontWeight.Bold),
)

/**
 * Tabular figures, and no ligatures: Azeret Mono draws "fi", "fl", "ff" and "ft" as one glyph,
 * which in a monospaced label reads like a typo ("Notiﬁcations"). iOS rewords around it.
 */
private const val MONO_FEATURES = "tnum, -liga"

/** Numbers everywhere: Azeret Mono with tabular figures (AGENTS.md design language). */
val Numeric = TextStyle(fontFamily = AzeretMono, fontFeatureSettings = MONO_FEATURES)

private fun mono(size: Int, line: Int, weight: FontWeight = FontWeight.Medium, spacing: Double = 0.0) = TextStyle(
    fontFamily = AzeretMono, fontWeight = weight, fontSize = size.sp, lineHeight = line.sp,
    letterSpacing = spacing.sp, fontFeatureSettings = MONO_FEATURES,
)

private fun body(size: Int, line: Int, weight: FontWeight = FontWeight.Normal) =
    TextStyle(fontFamily = Ubuntu, fontWeight = weight, fontSize = size.sp, lineHeight = line.sp)

val CrowTypography = Typography(
    displayLarge = mono(40, 48, FontWeight.SemiBold, -0.5),
    displayMedium = mono(34, 42, FontWeight.SemiBold, -0.5),
    displaySmall = mono(28, 36, FontWeight.SemiBold, -0.25),
    headlineLarge = mono(26, 34, FontWeight.SemiBold, -0.25),
    headlineMedium = mono(22, 30, FontWeight.SemiBold, -0.25),
    headlineSmall = mono(19, 26, FontWeight.SemiBold),
    titleLarge = mono(18, 24, FontWeight.SemiBold),
    titleMedium = mono(15, 22, FontWeight.Medium),
    titleSmall = mono(13, 18, FontWeight.Medium),
    bodyLarge = body(16, 24),
    bodyMedium = body(14, 20),
    bodySmall = body(12, 16),
    labelLarge = mono(13, 18, FontWeight.Medium, 0.2),
    labelMedium = mono(12, 16, FontWeight.Medium, 0.4),
    labelSmall = mono(11, 16, FontWeight.Medium, 0.6),
)

/** Small radii: precise, not bubbly. */
val CrowShapes = Shapes(
    extraSmall = RoundedCornerShape(4.dp),
    small = RoundedCornerShape(6.dp),
    medium = RoundedCornerShape(8.dp),
    large = RoundedCornerShape(8.dp),
    extraLarge = RoundedCornerShape(10.dp),
)

val LocalCrowColors = staticCompositionLocalOf { LightCrow }

/**
 * [size] grown with the user's text size up to [maxScale], for the few labels that must fit side
 * by side (five tab labels); everything else scales fully. iOS caps its tab bar labels too.
 */
@Composable
fun cappedTextSize(size: TextUnit, maxScale: Float = 1.5f): TextUnit {
    val scale = LocalDensity.current.fontScale
    return if (scale <= maxScale) size else (size.value * maxScale / scale).sp
}

object Crow {
    val colors: CrowColors @Composable get() = LocalCrowColors.current
}

@Composable
fun CrowTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalCrowColors provides if (dark) DarkCrow else LightCrow) {
        MaterialTheme(
            colorScheme = if (dark) DarkScheme else LightScheme,
            typography = CrowTypography,
            shapes = CrowShapes,
            content = content,
        )
    }
}
