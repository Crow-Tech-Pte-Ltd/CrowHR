package crowtech.crowhr.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import crowtech.crowhr.ui.theme.Crow
import crowtech.crowhr.ui.theme.Numeric

private val Radius = RoundedCornerShape(6.dp)

/**
 * The primary action: kuning fill, 2 dp ink border and the signature hard offset shadow
 * (never blurred). Used once per screen at most.
 */
@Composable
fun PrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    loading: Boolean = false,
) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val focused by interaction.collectIsFocusedAsState()
    val colors = Crow.colors
    val shadow = if (pressed || !enabled) 0.dp else 3.dp
    val active = enabled && !loading
    Box(
        modifier
            .heightIn(min = 48.dp)
            .drawBehind {
                if (shadow > 0.dp) {
                    val o = shadow.toPx()
                    drawRoundRect(colors.shadow, topLeft = Offset(o, o), size = size, cornerRadius = CornerRadius(6.dp.toPx()))
                }
            }
            .offset { val d = if (pressed) 2.dp.roundToPx() else 0; androidx.compose.ui.unit.IntOffset(d, d) }
            .background(if (enabled) colors.accent else colors.hairline, Radius)
            .border(2.dp, if (focused) colors.focus else if (enabled) colors.shadow else colors.muted, Radius)
            .clickable(interactionSource = interaction, indication = null, enabled = active, role = Role.Button, onClick = onClick)
            .padding(horizontal = 18.dp, vertical = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
            if (loading) {
                CircularProgressIndicator(Modifier.size(16.dp), color = colors.onAccent, strokeWidth = 2.dp)
                Spacer(Modifier.width(10.dp))
            }
            Text(text, style = MaterialTheme.typography.labelLarge, color = if (enabled) colors.onAccent else colors.muted, textAlign = TextAlign.Center)
        }
    }
}

enum class Tone { Neutral, Accent, Success, Warning, Danger }

/** Secondary and tertiary actions: hairline outline, no fill. [tone] Danger for "Reject". */
@Composable
fun SecondaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    tone: Tone = Tone.Neutral,
) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val colors = Crow.colors
    val fg = when {
        !enabled -> colors.muted
        tone == Tone.Danger -> colors.danger
        else -> colors.ink
    }
    Box(
        modifier
            .heightIn(min = 48.dp)
            .border(if (focused) 2.dp else 1.dp, if (focused) colors.focus else colors.ink.copy(alpha = 0.25f), Radius)
            .clickable(interactionSource = interaction, indication = null, enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = MaterialTheme.typography.labelLarge, color = fg, textAlign = TextAlign.Center)
    }
}

/** Links and low-emphasis actions in biru. */
@Composable
fun LinkButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier
            .heightIn(min = 48.dp)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 4.dp, vertical = 12.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        Text(text, style = MaterialTheme.typography.labelLarge, color = Crow.colors.link)
    }
}

/** Hairline card: 1 dp ink at low opacity, no shadow. */
@Composable
fun CrowCard(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    padding: PaddingValues = PaddingValues(16.dp),
    border: Dp = 1.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = Crow.colors
    Column(
        modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface, Radius)
            .border(BorderStroke(border, if (border > 1.dp) colors.ink else colors.hairline), Radius)
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier)
            .padding(padding),
        content = content,
    )
}

/** Mono uppercase label above fields and sections. */
@Composable
fun Label(text: String, modifier: Modifier = Modifier, color: Color = Crow.colors.muted) {
    Text(text.uppercase(), modifier, style = MaterialTheme.typography.labelSmall, color = color)
}

@Composable
fun ScreenTitle(title: String, subtitle: String? = null, modifier: Modifier = Modifier) {
    Column(modifier.padding(bottom = 12.dp)) {
        Text(title, style = MaterialTheme.typography.headlineMedium, modifier = Modifier.semantics { heading() })
        if (subtitle != null) {
            Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = Crow.colors.muted, modifier = Modifier.padding(top = 2.dp))
        }
    }
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(text, style = MaterialTheme.typography.titleMedium, modifier = modifier.padding(top = 20.dp, bottom = 8.dp).semantics { heading() })
}

@Composable
fun StatusChip(text: String, tone: Tone, modifier: Modifier = Modifier) {
    val c = Crow.colors
    val (bg, fg) = when (tone) {
        Tone.Neutral -> MaterialTheme.colorScheme.surfaceVariant to c.ink
        Tone.Accent -> c.accentSoft to c.ink
        Tone.Success -> c.successSoft to c.success
        Tone.Warning -> c.warningSoft to c.warning
        Tone.Danger -> c.dangerSoft to c.danger
    }
    Text(
        text,
        modifier.background(bg, RoundedCornerShape(4.dp)).padding(horizontal = 8.dp, vertical = 3.dp),
        style = MaterialTheme.typography.labelSmall,
        color = fg,
    )
}

/** Inline message: tone-coloured left rule, no icons-as-decoration. */
@Composable
fun Notice(text: String, tone: Tone = Tone.Neutral, modifier: Modifier = Modifier, title: String? = null) {
    val c = Crow.colors
    val (bg, rule) = when (tone) {
        Tone.Neutral -> MaterialTheme.colorScheme.surfaceVariant to c.muted
        Tone.Accent -> c.accentSoft to c.accent
        Tone.Success -> c.successSoft to c.success
        Tone.Warning -> c.warningSoft to c.warning
        Tone.Danger -> c.dangerSoft to c.danger
    }
    Row(modifier.fillMaxWidth().background(bg, Radius)) {
        Box(Modifier.width(3.dp).heightIn(min = 40.dp).background(rule, RoundedCornerShape(topStart = 6.dp, bottomStart = 6.dp)))
        Column(Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
            if (title != null) Text(title, style = MaterialTheme.typography.titleSmall, color = c.ink)
            Text(text, style = MaterialTheme.typography.bodyMedium, color = c.ink)
        }
    }
}

/**
 * Label on the left, value on the right; [numeric] values are mono, tabular, right-aligned.
 * TalkBack reads the row as one item, saying [spoken] for the value when given (amounts).
 */
@Composable
fun KeyValueRow(label: String, value: String, modifier: Modifier = Modifier, numeric: Boolean = false, strong: Boolean = false, spoken: String? = null) {
    Row(
        modifier.fillMaxWidth().heightIn(min = 36.dp).padding(vertical = 6.dp).semantics(mergeDescendants = true) {},
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = if (strong) Crow.colors.ink else Crow.colors.muted)
        Text(
            value,
            modifier = if (spoken != null) Modifier.semantics { contentDescription = spoken } else Modifier,
            style = if (numeric) Numeric.copy(fontSize = MaterialTheme.typography.bodyMedium.fontSize, fontWeight = if (strong) FontWeight.SemiBold else FontWeight.Normal)
            else MaterialTheme.typography.bodyMedium,
            textAlign = TextAlign.End,
        )
    }
}

/** An amount in S$ that TalkBack reads as "… Singapore dollars …". */
fun Modifier.spokenMoney(cents: Long): Modifier = semantics { contentDescription = crowtech.crowhr.core.Formats.moneySpoken(cents) }

@Composable
fun Hairline(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().heightIn(min = 1.dp, max = 1.dp).background(Crow.colors.hairline))
}
