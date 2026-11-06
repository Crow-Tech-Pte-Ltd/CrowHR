package crowtech.crowhr.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import crowtech.crowhr.api.ClaimCreated
import crowtech.crowhr.api.ClaimInput
import crowtech.crowhr.api.ClaimLineInput
import crowtech.crowhr.api.ClaimPage
import crowtech.crowhr.api.ClaimTypeOption
import crowtech.crowhr.api.Items
import crowtech.crowhr.api.Receipt
import crowtech.crowhr.connect.UrlCodec
import crowtech.crowhr.core.Formats
import crowtech.crowhr.ui.Images
import crowtech.crowhr.ui.Route
import crowtech.crowhr.ui.ScreenContext
import crowtech.crowhr.ui.components.CrowCard
import crowtech.crowhr.ui.components.EmptyState
import crowtech.crowhr.ui.components.FieldError
import crowtech.crowhr.ui.components.Hairline
import crowtech.crowhr.ui.components.Label
import crowtech.crowhr.ui.components.LinkButton
import crowtech.crowhr.ui.components.LoadContent
import crowtech.crowhr.ui.components.Notice
import crowtech.crowhr.ui.components.PrimaryButton
import crowtech.crowhr.ui.components.ScreenTitle
import crowtech.crowhr.ui.components.SecondaryButton
import crowtech.crowhr.ui.components.StatusChip
import crowtech.crowhr.ui.components.Tone
import crowtech.crowhr.ui.components.rememberLoader
import crowtech.crowhr.ui.components.userMessage
import crowtech.crowhr.ui.theme.Crow
import crowtech.crowhr.ui.theme.Numeric
import kotlinx.coroutines.launch
import java.time.LocalDate

private val ELIGIBLE = Items.serializer(ClaimTypeOption.serializer())

/** ISO 4217 minor-unit digits (JPY 0, SGD 2, KWD 3); null for an unknown code. */
fun fractionDigits(code: String): Int? = runCatching { java.util.Currency.getInstance(code).defaultFractionDigits }.getOrNull()?.takeIf { it >= 0 }

/** "1,250.5" MYR → 125050 (exact: never through floating point); null when not representable. */
fun foreignMinor(text: String, code: String): Long? {
    val digits = fractionDigits(code) ?: return null
    val value = text.replace(",", "").trim().toBigDecimalOrNull() ?: return null
    if (value.stripTrailingZeros().scale() > digits) return null
    return runCatching { value.movePointRight(digits).longValueExact() }.getOrNull()
}

fun claimStatus(status: String): Pair<String, Tone> = when (status) {
    "draft" -> "Draft" to Tone.Neutral
    "submitted" -> "Waiting for approval" to Tone.Accent
    "approved" -> "Approved" to Tone.Success
    "rejected" -> "Rejected" to Tone.Danger
    "withdrawn" -> "Withdrawn" to Tone.Neutral
    "paid" -> "Paid" to Tone.Success
    else -> status to Tone.Neutral
}

@Composable
fun ClaimsScreen(ctx: ScreenContext) {
    val loader = rememberLoader(ctx.connection.key) {
        ctx.api.get("/api/v1/claims", ClaimPage.serializer(), mapOf("mine" to "true", "pageSize" to "50", "sort" to "-createdAt"))
    }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ScreenTitle("Claims", "Expenses you paid for the company.")
        PrimaryButton("New claim", { ctx.push(Route.NewClaim) }, Modifier.fillMaxWidth().testTag("new-claim"))
        LoadContent(loader, "Loading claims…") { page ->
            if (page.items.isEmpty()) EmptyState("No claims yet", "Snap a receipt and claim it here. HR pays approved claims with your salary or separately.")
            page.items.forEach { c ->
                val (label, tone) = claimStatus(c.status)
                Column(Modifier.fillMaxWidth().padding(vertical = 8.dp).testTag("claim-row")) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(c.title ?: c.typeNames.joinToString(", ").ifEmpty { "Claim" }, style = MaterialTheme.typography.titleSmall)
                            Text(
                                listOfNotNull(c.claimNumber, c.expenseFrom?.let(Formats::date), "${c.lineCount} ${if (c.lineCount == 1) "item" else "items"}").joinToString(" · "),
                                style = MaterialTheme.typography.bodySmall, color = Crow.colors.muted,
                            )
                        }
                        Text(Formats.money(c.totalCents), style = Numeric.copy(fontWeight = FontWeight.SemiBold))
                    }
                    StatusChip(label, tone, Modifier.padding(top = 4.dp))
                }
                Hairline()
            }
        }
    }
}

private class LineDraft {
    var type by mutableStateOf<ClaimTypeOption?>(null)
    var date by mutableStateOf(LocalDate.now(Formats.SINGAPORE))
    var merchant by mutableStateOf("")
    var description by mutableStateOf("")
    var amount by mutableStateOf("")
    var currency by mutableStateOf("SGD")
    var rate by mutableStateOf("")
    val receipts = mutableStateListOf<Receipt>()
    var uploading by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewClaimScreen(ctx: ScreenContext) {
    val scope = rememberCoroutineScope()
    val types = rememberLoader(ctx.connection.key) { ctx.api.get("/api/v1/claims/eligible-types", ELIGIBLE) }
    val lines = remember { mutableStateListOf(LineDraft()) }
    var title by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf<String?>(null) }
    var done by remember { mutableStateOf<ClaimCreated?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ScreenTitle("New claim")
        done?.let { c ->
            Notice(
                if (c.status == "draft") "Saved as a draft. Submit it when it's ready." else "Claim ${c.claimNumber ?: ""} sent for approval (${Formats.money(c.totalCents)}).",
                Tone.Success, title = if (c.status == "draft") "Draft saved" else "Claim sent",
            )
            PrimaryButton("Done", ctx.pop, Modifier.fillMaxWidth().testTag("claim-done"))
            return@Column
        }
        OutlinedTextField(title, { title = it }, label = { Text("Title (optional)") }, placeholder = { Text("Client visit, October") }, modifier = Modifier.fillMaxWidth())
        LoadContent(types, "Loading claim types…") { list ->
            if (list.items.isEmpty()) Notice("You have no claim types available. Ask HR.", Tone.Warning)
            lines.forEachIndexed { index, line ->
                ClaimLineEditor(ctx, index, line, list.items, onRemove = if (lines.size > 1) ({ lines.remove(line) }) else null)
            }
            LinkButton("Add another item", { lines.add(LineDraft()) })
        }
        error?.let { Notice(it, Tone.Danger) }
        fun save(submit: Boolean) {
            val built = mutableListOf<ClaimLineInput>()
            var ok = true
            for (line in lines) {
                line.error = null
                val type = line.type
                val currency = line.currency.trim().uppercase()
                val sgd = currency == "SGD"
                val parsed = if (sgd) Formats.parseMoney(line.amount) else null
                val minor = if (sgd) (parsed as? Formats.MoneyParse.Ok)?.cents else foreignMinor(line.amount, currency)
                val sgdCents = if (sgd) minor else null
                line.error = when {
                    type == null -> "Choose what this expense was for."
                    line.merchant.isBlank() -> "Enter where you paid (the shop or company)."
                    parsed is Formats.MoneyParse.Error -> Formats.moneyParseMessage(parsed.reason)
                    minor == null -> "Enter the amount in $currency with at most ${fractionDigits(currency) ?: 2} decimal places, or check the currency code (such as MYR or USD)."
                    minor <= 0 -> "Enter an amount above zero."
                    !sgd && line.rate.trim().toBigDecimalOrNull()?.signum() != 1 -> "Enter the exchange rate to S$ (for example 0.0089)."
                    type.receiptRule == "always" && line.receipts.isEmpty() && submit -> "Add a photo of the receipt."
                    type.receiptRule == "above" && line.receipts.isEmpty() && submit && (sgdCents ?: Long.MAX_VALUE) > (type.receiptAboveCents ?: 0) ->
                        "Add a photo of the receipt (needed above ${Formats.money(type.receiptAboveCents ?: 0)})."
                    else -> null
                }
                if (line.error != null) { ok = false; continue }
                built += ClaimLineInput(
                    claimTypeId = type!!.id, expenseDate = line.date.toString(), merchant = line.merchant.trim(),
                    description = line.description.trim().ifEmpty { type.name }, currency = currency,
                    amountMinor = minor!!,
                    rate = if (sgd) null else line.rate.trim(),
                    receiptIds = line.receipts.map { it.id },
                )
            }
            if (!ok) { error = "Check the items marked below."; return }
            error = null
            saving = if (submit) "submit" else "draft"
            scope.launch {
                try {
                    done = ctx.api.post("/api/v1/claims", ClaimInput(title.trim().ifEmpty { null }, built, submit), ClaimInput.serializer(), ClaimCreated.serializer())
                } catch (e: Exception) {
                    error = e.userMessage()
                }
                saving = null
            }
        }
        PrimaryButton("Submit claim", { save(true) }, Modifier.fillMaxWidth().testTag("submit-claim"), loading = saving == "submit", enabled = saving == null)
        SecondaryButton("Save as draft", { save(false) }, Modifier.fillMaxWidth(), enabled = saving == null)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ClaimLineEditor(ctx: ScreenContext, index: Int, line: LineDraft, types: List<ClaimTypeOption>, onRemove: (() -> Unit)?) {
    val scope = rememberCoroutineScope()
    val capture = ctx.graph.receiptCamera.rememberCapture { file ->
        if (file == null) return@rememberCapture
        line.uploading = true
        scope.launch {
            try {
                val bytes = Images.compressForUpload(file)
                val receipt = ctx.api.postBytes(
                    "/api/v1/claims/receipts?fileName=${UrlCodec.encode("receipt-${line.date}.jpg")}",
                    bytes, "image/jpeg", Receipt.serializer(),
                )
                line.receipts.add(receipt)
            } catch (e: Exception) {
                line.error = e.userMessage()
            }
            file.delete()
            line.uploading = false
        }
    }
    CrowCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Label("Item ${index + 1}", Modifier.weight(1f))
            if (onRemove != null) LinkButton("Remove", onRemove)
        }
        var expanded by remember { mutableStateOf(false) }
        ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
            OutlinedTextField(
                value = line.type?.name ?: "", onValueChange = {}, readOnly = true,
                label = { Text("Type") }, placeholder = { Text("Choose a claim type") },
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
                modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable).testTag("claim-type-$index"),
            )
            ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                types.forEach { t -> DropdownMenuItem(text = { Text(t.name) }, onClick = { line.type = t; expanded = false }) }
            }
        }
        line.type?.receiptHint?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Crow.colors.muted, modifier = Modifier.padding(top = 4.dp)) }
        DateField("Date of expense", line.date, Modifier.padding(top = 8.dp)) { line.date = it }
        OutlinedTextField(line.merchant, { line.merchant = it }, label = { Text("Paid to") }, placeholder = { Text("Grab, Kopitiam…") }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp).testTag("claim-merchant-$index"))
        OutlinedTextField(line.description, { line.description = it }, label = { Text("What for (optional)") }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
            OutlinedTextField(
                line.currency, { line.currency = it.take(3).uppercase() }, label = { Text("Currency") }, singleLine = true,
                modifier = Modifier.weight(1f),
            )
            OutlinedTextField(
                line.amount, { line.amount = it }, label = { Text("Amount") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.weight(2f).testTag("claim-amount-$index"),
                textStyle = Numeric,
            )
        }
        if (line.currency.uppercase() != "SGD") {
            OutlinedTextField(
                line.rate, { line.rate = it }, label = { Text("Rate to S$") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp), textStyle = Numeric,
            )
        }
        line.receipts.forEach { r -> Text("Receipt: ${r.name}", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp).testTag("receipt-attached")) }
        SecondaryButton(
            if (line.uploading) "Uploading receipt…" else if (line.receipts.isEmpty()) "Photograph receipt" else "Add another photo",
            capture, Modifier.fillMaxWidth().padding(top = 8.dp).testTag("receipt-$index"), enabled = !line.uploading,
        )
        FieldError(line.error)
    }
}
