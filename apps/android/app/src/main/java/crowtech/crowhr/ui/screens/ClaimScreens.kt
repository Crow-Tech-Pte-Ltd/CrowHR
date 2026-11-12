package crowtech.crowhr.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import crowtech.crowhr.api.ApiException
import crowtech.crowhr.api.ClaimDetail
import crowtech.crowhr.api.ClaimInput
import crowtech.crowhr.api.ClaimLine
import crowtech.crowhr.api.ClaimLineInput
import crowtech.crowhr.api.ClaimPage
import crowtech.crowhr.api.ClaimTypeOption
import crowtech.crowhr.api.ClaimUpdate
import crowtech.crowhr.api.Items
import crowtech.crowhr.api.Receipt
import crowtech.crowhr.connect.UrlCodec
import crowtech.crowhr.core.ClaimMoney
import crowtech.crowhr.core.CrowJson
import crowtech.crowhr.core.Formats
import crowtech.crowhr.ui.Images
import crowtech.crowhr.ui.Route
import crowtech.crowhr.ui.ScreenContext
import crowtech.crowhr.ui.components.CrowCard
import crowtech.crowhr.ui.components.CrowIcons
import crowtech.crowhr.ui.components.EmptyState
import crowtech.crowhr.ui.components.FieldError
import crowtech.crowhr.ui.components.Hairline
import crowtech.crowhr.ui.components.KeyValueRow
import crowtech.crowhr.ui.components.Label
import crowtech.crowhr.ui.components.LinkButton
import crowtech.crowhr.ui.components.LoadContent
import crowtech.crowhr.ui.components.LoadState
import crowtech.crowhr.ui.components.Notice
import crowtech.crowhr.ui.components.PrimaryButton
import crowtech.crowhr.ui.components.ScreenTitle
import crowtech.crowhr.ui.components.SecondaryButton
import crowtech.crowhr.ui.components.SectionTitle
import crowtech.crowhr.ui.components.StatusChip
import crowtech.crowhr.ui.components.Tone
import crowtech.crowhr.ui.components.jsonSaver
import crowtech.crowhr.ui.components.rememberLoader
import crowtech.crowhr.ui.components.userMessage
import crowtech.crowhr.ui.theme.Crow
import crowtech.crowhr.ui.theme.Numeric
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.nullable
import java.time.LocalDate

private val ELIGIBLE = Items.serializer(ClaimTypeOption.serializer())

fun claimStatus(status: String): Pair<String, Tone> = when (status) {
    "draft" -> "Draft" to Tone.Neutral
    "submitted" -> "Waiting for approval" to Tone.Accent
    "approved" -> "Approved" to Tone.Success
    "rejected" -> "Rejected" to Tone.Danger
    "withdrawn" -> "Withdrawn" to Tone.Neutral
    "paid" -> "Paid" to Tone.Success
    else -> status to Tone.Neutral
}

/** What a claim line's fields hold, as typed (also the saved state: rotation, process death). */
@Serializable
data class ClaimLineValues(
    val type: ClaimTypeOption? = null,
    val date: String,
    val merchant: String = "",
    val description: String = "",
    val amount: String = "",
    val currency: String = "SGD",
    val rate: String = "",
    val receipts: List<Receipt> = emptyList(),
    val error: String? = null,
)

/** The claim form's rules, kept out of the screen so they can be unit tested. */
object ClaimForm {
    sealed interface Check {
        data class Ok(val line: ClaimLineInput) : Check
        data class Problem(val message: String) : Check
    }

    /** The amount in the line's currency's minor units, or null while it isn't a valid amount. */
    fun amountMinor(v: ClaimLineValues): Long? =
        if (v.currency == "SGD") (Formats.parseMoney(v.amount) as? Formats.MoneyParse.Ok)?.cents?.takeIf { it > 0 }
        else ClaimMoney.parseMinor(v.amount, ClaimMoney.exponentOf(v.currency))

    /** The S$ amount shown under the line (web: the live SGD preview), or null while incomplete. */
    fun sgdCents(v: ClaimLineValues): Long? = ClaimMoney.previewSgd(v.currency, amountMinor(v), v.rate.ifBlank { null })

    /** The claim total: the sum of the lines' rounded S$ amounts (incomplete lines count as 0). */
    fun total(lines: List<ClaimLineValues>): Long = lines.sumOf { sgdCents(it) ?: 0L }

    fun check(v: ClaimLineValues, submit: Boolean): Check {
        val type = v.type ?: return Check.Problem("Choose what this expense was for.")
        if (v.merchant.isBlank()) return Check.Problem("Enter where you paid (the shop or company).")
        val sgd = v.currency == "SGD"
        val exponent = ClaimMoney.exponentOf(v.currency)
        val minor: Long
        if (sgd) {
            when (val parsed = Formats.parseMoney(v.amount)) {
                is Formats.MoneyParse.Error -> return Check.Problem(Formats.moneyParseMessage(parsed.reason))
                is Formats.MoneyParse.Ok -> minor = parsed.cents
            }
            if (minor <= 0) return Check.Problem("Enter an amount above zero.")
        } else {
            minor = ClaimMoney.parseMinor(v.amount, exponent) ?: return Check.Problem(
                if (exponent == 0) "Enter a whole amount in ${v.currency}, such as 5000."
                else "Enter the amount in ${v.currency} with at most $exponent decimal places, such as 45.60.",
            )
            if (ClaimMoney.parseRateMicros(v.rate) == null) {
                return Check.Problem("Enter the rate as S$ per 1 ${v.currency}, with up to 6 decimal places (for example 0.301234).")
            }
        }
        val sgdCents = sgdCents(v)
        if (submit && v.receipts.isEmpty()) {
            if (type.receiptRule == "always") return Check.Problem("Add a photo of the receipt.")
            if (type.receiptRule == "above" && (sgdCents ?: Long.MAX_VALUE) > (type.receiptAboveCents ?: 0)) {
                return Check.Problem("Add a photo of the receipt (needed above ${Formats.money(type.receiptAboveCents ?: 0)}).")
            }
        }
        return Check.Ok(
            ClaimLineInput(
                claimTypeId = type.id, expenseDate = v.date, merchant = v.merchant.trim(),
                description = v.description.trim().ifEmpty { type.name }, currency = v.currency,
                amountMinor = minor, rate = if (sgd) null else v.rate.trim(),
                receiptIds = v.receipts.map { it.id },
            ),
        )
    }

    /**
     * A saved claim's lines back in the form (editing a draft). A type no longer offered to the
     * employee keeps its name, so the line still shows what it was; the server decides on save.
     */
    fun fromClaim(claim: ClaimDetail, types: List<ClaimTypeOption>): List<ClaimLineValues> = claim.lines.map { l ->
        ClaimLineValues(
            type = types.firstOrNull { it.id == l.claimTypeId } ?: ClaimTypeOption(l.claimTypeId, l.typeCode, l.typeName.ifBlank { "Claim type" }, l.category),
            date = l.expenseDate,
            merchant = l.merchant.orEmpty(),
            // The app fills an empty description with the type's name; show it empty again.
            description = l.description.orEmpty().takeUnless { it == l.typeName }.orEmpty(),
            amount = ClaimMoney.editableAmount(l.amountMinor, ClaimMoney.exponentOf(l.currency)),
            currency = l.currency,
            rate = if (l.currency == "SGD") "" else l.rate.orEmpty(),
            receipts = l.receipts.filterNot { it.removed }.map { Receipt(it.id, it.name, it.mime, it.sizeBytes) },
        )
    }

    /**
     * The exchange-rate warning for a line, as the web words it: "MYR 0.380000 is 26.15% above
     * the last MYR rate used in your organisation, 0.301234 on 1 Nov 2026." Null without one.
     */
    fun fxWarningText(line: ClaimLine, index: Int, lineCount: Int): String? {
        val w = line.fxWarning ?: return null
        return (if (lineCount > 1) "Item ${index + 1}: " else "") +
            "${line.currency} ${line.rate ?: "?"} is ${ClaimMoney.formatBasisPoints(w.deviationBasisPoints)} " +
            "${if (w.deviationBasisPoints >= 0) "above" else "below"} the last ${line.currency} rate used in your organisation, " +
            "${w.lastRate} on ${Formats.date(w.lastRateOn)}."
    }

    /** "1 item" / "3 items". */
    fun items(count: Int) = "$count ${if (count == 1) "item" else "items"}"
}

@Composable
fun ClaimsScreen(ctx: ScreenContext) {
    val loader = rememberLoader(ctx.connection.key) {
        ctx.api.get("/api/v1/claims", ClaimPage.serializer(), mapOf("mine" to "true", "pageSize" to "50", "sort" to "-createdAt"))
    }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ScreenTitle("Claims", "Expenses you paid for the company. Tap a claim to see it, or to change or send a draft.")
        PrimaryButton("New claim", { ctx.push(Route.NewClaim) }, Modifier.fillMaxWidth().testTag("new-claim"))
        LoadContent(loader, "Loading claims…") { page ->
            if (page.items.isEmpty()) EmptyState("No claims yet", "Snap a receipt and claim it here. HR pays approved claims with your salary or separately.")
            page.items.forEach { c ->
                val (label, tone) = claimStatus(c.status)
                // One TalkBack item per claim: title, details, amount and status, then "double-tap to open".
                Row(
                    Modifier.fillMaxWidth().clickable(role = Role.Button) { ctx.push(Route.ClaimDetail(c.id)) }
                        .padding(vertical = 8.dp).semantics(mergeDescendants = true) {}.testTag("claim-row"),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(c.title ?: c.typeNames.joinToString(", ").ifEmpty { "Claim" }, style = MaterialTheme.typography.titleSmall)
                                Text(
                                    listOfNotNull(c.claimNumber, c.expenseFrom?.let(Formats::date), ClaimForm.items(c.lineCount)).joinToString(" · "),
                                    style = MaterialTheme.typography.bodySmall, color = Crow.colors.muted,
                                )
                            }
                            Text(
                                Formats.money(c.totalCents), style = Numeric.copy(fontWeight = FontWeight.SemiBold),
                                modifier = Modifier.semantics { contentDescription = Formats.moneySpoken(c.totalCents) },
                            )
                        }
                        StatusChip(label, tone, Modifier.padding(top = 4.dp))
                    }
                    Icon(CrowIcons.Chevron, contentDescription = null, tint = Crow.colors.muted, modifier = Modifier.padding(start = 8.dp).size(18.dp))
                }
                Hairline()
            }
        }
    }
}

/** One claim: its lines and what can be done with it now (the server's `actions`). */
@Composable
fun ClaimDetailScreen(ctx: ScreenContext, id: String) {
    val scope = rememberCoroutineScope()
    val loader = rememberLoader(ctx.connection.key, id) { ctx.api.get("/api/v1/claims/$id", ClaimDetail.serializer()) }
    var busy by remember { mutableStateOf<String?>(null) }
    var done by rememberSaveable { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirm by rememberSaveable { mutableStateOf<String?>(null) }

    fun act(name: String, success: String?, call: suspend () -> ClaimDetail?) {
        busy = name
        error = null
        done = null
        scope.launch {
            try {
                val result = call()
                confirm = null
                if (name == "copy" && result != null) {
                    // The copy is a new draft: show it, and open it for changes straight away.
                    ctx.replace(Route.ClaimDetail(result.id))
                    ctx.push(Route.EditClaim(result.id))
                } else if (name == "delete") {
                    ctx.pop()
                } else {
                    done = success
                    loader.reload()
                }
            } catch (e: Exception) {
                error = e.userMessage()
            }
            busy = null
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        LoadContent(loader, "Loading the claim…") { c ->
            val (label, tone) = claimStatus(c.status)
            ScreenTitle(c.title ?: c.lines.map { it.typeName }.distinct().joinToString(", ").ifEmpty { "Claim" }, c.claimNumber)
            StatusChip(label, tone, Modifier.testTag("claim-status"))
            done?.let { Notice(it, Tone.Success, Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
            CrowCard {
                KeyValueRow("Total", Formats.money(c.totalCents), numeric = true, strong = true, spoken = Formats.moneySpoken(c.totalCents), modifier = Modifier.testTag("claim-detail-total"))
                KeyValueRow("Items", c.lines.size.toString(), numeric = true)
                c.submittedAt?.let { s -> Formats.parseInstant(s)?.let { KeyValueRow("Sent", Formats.dateTime(it), numeric = true) } }
                c.decidedAt?.let { s -> Formats.parseInstant(s)?.let { KeyValueRow("Decided", Formats.dateTime(it), numeric = true) } }
            }
            val fx = c.lines.mapIndexedNotNull { i, l -> ClaimForm.fxWarningText(l, i, c.lines.size) }
            if (fx.isNotEmpty()) {
                Notice(
                    (fx + "Compare it with the receipt or card statement.").joinToString("\n"),
                    Tone.Warning, Modifier.testTag("fx-warning"), title = "Check the exchange rate",
                )
            }
            c.decisionComment?.takeIf { it.isNotBlank() }?.let {
                Notice(it, if (c.status == "rejected") Tone.Danger else Tone.Neutral, title = "Comment from your approver")
            }
            if (c.status == "draft") {
                Text("A draft isn't sent yet. Change it, then submit it for approval when it's ready.", style = MaterialTheme.typography.bodyMedium, color = Crow.colors.muted)
            }
            SectionTitle("Items")
            c.lines.forEachIndexed { i, line -> ClaimLineSummary(i, line) }
            error?.let { Notice(it, Tone.Danger, Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
            val a = c.actions
            Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                if (a.edit) PrimaryButton("Change draft", { ctx.push(Route.EditClaim(c.id)) }, Modifier.fillMaxWidth().testTag("claim-edit"), enabled = busy == null)
                if (a.submit) {
                    SecondaryButton(
                        if (busy == "submit") "Submitting…" else "Submit for approval",
                        { act("submit", "Sent for approval. You'll see the decision here and in Notifications.") { ctx.api.postEmpty("/api/v1/claims/${c.id}/submit", ClaimDetail.serializer()) } },
                        Modifier.fillMaxWidth().testTag("claim-submit"), enabled = busy == null,
                    )
                }
                if (a.withdraw) {
                    if (confirm == "withdraw") {
                        Notice("Withdraw this claim? Your approver won't see it any more. You can copy it into a new draft later.", Tone.Warning)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            SecondaryButton(
                                "Withdraw",
                                { act("withdraw", "Withdrawn. Copy it into a new draft to send it again.") { ctx.api.postEmpty("/api/v1/claims/${c.id}/withdraw", ClaimDetail.serializer()) } },
                                Modifier.weight(1f).testTag("claim-withdraw-confirm"), tone = Tone.Danger, enabled = busy == null,
                            )
                            SecondaryButton("Keep", { confirm = null }, Modifier.weight(1f), enabled = busy == null)
                        }
                    } else {
                        SecondaryButton("Withdraw…", { confirm = "withdraw"; error = null }, Modifier.fillMaxWidth().testTag("claim-withdraw"), tone = Tone.Danger, enabled = busy == null)
                    }
                }
                if (a.copy) {
                    SecondaryButton(
                        if (busy == "copy") "Copying…" else "Copy into a new draft",
                        { act("copy", null) { ctx.api.postEmpty("/api/v1/claims/${c.id}/copy", ClaimDetail.serializer()) } },
                        Modifier.fillMaxWidth().testTag("claim-copy"), enabled = busy == null,
                    )
                }
                if (a.delete) {
                    if (confirm == "delete") {
                        Notice("Delete this draft? Its receipts are removed too. This can't be undone.", Tone.Warning)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            SecondaryButton(
                                "Delete draft",
                                { act("delete", null) { ctx.api.delete("/api/v1/claims/${c.id}"); null } },
                                Modifier.weight(1f).testTag("claim-delete-confirm"), tone = Tone.Danger, enabled = busy == null,
                            )
                            SecondaryButton("Keep", { confirm = null }, Modifier.weight(1f), enabled = busy == null)
                        }
                    } else {
                        LinkButton("Delete draft…", { confirm = "delete"; error = null }, Modifier.testTag("claim-delete"))
                    }
                }
            }
        }
    }
}

@Composable
private fun ClaimLineSummary(index: Int, line: ClaimLine) {
    CrowCard(modifier = Modifier.semantics(mergeDescendants = true) {}.testTag("claim-line-$index")) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(line.typeName, style = MaterialTheme.typography.titleSmall)
                Text(
                    listOfNotNull(Formats.date(line.expenseDate), line.merchant?.ifBlank { null }).joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall, color = Crow.colors.muted,
                )
            }
            Text(
                Formats.money(line.sgdCents), style = Numeric.copy(fontWeight = FontWeight.SemiBold),
                modifier = Modifier.semantics { contentDescription = Formats.moneySpoken(line.sgdCents) },
            )
        }
        line.description?.takeIf { it.isNotBlank() && it != line.typeName }?.let { Text(it, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 4.dp)) }
        if (line.currency != "SGD") {
            Text(
                "${ClaimMoney.formatForeign(line.currency, line.amountMinor)} at ${line.rate ?: "?"} S$ per ${line.currency}",
                style = Numeric.copy(fontSize = MaterialTheme.typography.bodySmall.fontSize), color = Crow.colors.muted,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
        val receipts = line.receipts.count { !it.removed }.takeIf { line.receipts.isNotEmpty() } ?: line.receiptCount
        Text(
            if (receipts == 0) "No receipt" else "$receipts ${if (receipts == 1) "receipt" else "receipts"}",
            style = MaterialTheme.typography.bodySmall, color = Crow.colors.muted, modifier = Modifier.padding(top = 4.dp),
        )
    }
}

private class LineDraft(saved: ClaimLineValues? = null) {
    var type by mutableStateOf(saved?.type)
    var date by mutableStateOf(saved?.date?.let { runCatching { LocalDate.parse(it) }.getOrNull() } ?: LocalDate.now(Formats.SINGAPORE))
    var merchant by mutableStateOf(saved?.merchant ?: "")
    var description by mutableStateOf(saved?.description ?: "")
    var amount by mutableStateOf(saved?.amount ?: "")
    var currency by mutableStateOf(saved?.currency ?: "SGD")
    var rate by mutableStateOf(saved?.rate ?: "")
    val receipts = mutableStateListOf<Receipt>().apply { saved?.receipts?.let(::addAll) }
    var uploading by mutableStateOf(false)
    var error by mutableStateOf(saved?.error)

    fun values() = ClaimLineValues(type, date.toString(), merchant, description, amount, currency, rate, receipts.toList(), error)
}

private val SAVED_LINES = ListSerializer(ClaimLineValues.serializer())

/** Keeps the claim's lines, including receipts already uploaded, across rotation and process death. */
private val LinesSaver = Saver<SnapshotStateList<LineDraft>, String>(
    save = { lines -> CrowJson.encodeToString(SAVED_LINES, lines.map { it.values() }) },
    restore = { json ->
        runCatching { CrowJson.decodeFromString(SAVED_LINES, json) }.getOrNull()
            ?.takeIf { it.isNotEmpty() }
            ?.let { saved -> mutableStateListOf<LineDraft>().apply { addAll(saved.map(::LineDraft)) } }
    },
)

/** What the form saved, for the confirmation (small: kept in the saved state). */
@Serializable
private data class ClaimSaved(val id: String, val status: String, val claimNumber: String? = null, val totalCents: Long)

@Composable
fun NewClaimScreen(ctx: ScreenContext) = ClaimEditorScreen(ctx, editId = null)

/** A new claim, or a saved draft opened for changes ([editId]). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ClaimEditorScreen(ctx: ScreenContext, editId: String?) {
    val scope = rememberCoroutineScope()
    val types = rememberLoader(ctx.connection.key) { ctx.api.get("/api/v1/claims/eligible-types", ELIGIBLE) }
    val existing = if (editId != null) rememberLoader(ctx.connection.key, editId) { ctx.api.get("/api/v1/claims/$editId", ClaimDetail.serializer()) } else null
    val lines = rememberSaveable(saver = LinesSaver) { mutableStateListOf(LineDraft()) }
    var title by rememberSaveable { mutableStateOf("") }
    // A draft's lines are put in the form once; after that the form (and its saved state) wins.
    var filled by rememberSaveable { mutableStateOf(editId == null) }
    var saving by remember { mutableStateOf<String?>(null) }
    var done by rememberSaveable(stateSaver = jsonSaver(ClaimSaved.serializer().nullable)) { mutableStateOf(null) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }

    val draft = (existing?.value as? LoadState.Ready)?.value
    // Types that failed to load: fill the form anyway; their error shows where the types go.
    val typeList = when (val t = types.value) {
        is LoadState.Ready -> t.value.items
        is LoadState.Failed -> emptyList()
        LoadState.Loading -> null
    }
    LaunchedEffect(draft, typeList) {
        if (filled || draft == null || typeList == null) return@LaunchedEffect
        val values = ClaimForm.fromClaim(draft, typeList)
        if (values.isNotEmpty()) {
            lines.clear()
            lines.addAll(values.map(::LineDraft))
        }
        title = draft.title.orEmpty()
        filled = true
    }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ScreenTitle(if (editId == null) "New claim" else "Change draft", draft?.claimNumber)
        done?.let { c ->
            if (c.status == "draft") {
                Notice(
                    "Saved as a draft (${Formats.money(c.totalCents)}). It isn't sent yet: open it from Claims to change it or submit it.",
                    Tone.Success, title = "Saved for later",
                )
            } else {
                Notice(listOfNotNull("Claim", c.claimNumber, "sent for approval (${Formats.money(c.totalCents)}).").joinToString(" "), Tone.Success, title = "Claim sent")
            }
            PrimaryButton("Done", ctx.pop, Modifier.fillMaxWidth().testTag("claim-done"))
            if (c.status == "draft" && editId == null) {
                SecondaryButton("Open the draft", { ctx.replace(Route.ClaimDetail(c.id)) }, Modifier.fillMaxWidth().testTag("claim-open-draft"))
            }
            return@Column
        }
        if (existing != null) {
            when (val s = existing.value) {
                is LoadState.Ready -> if (!s.value.actions.edit) {
                    Notice("This claim can't be changed any more: it was sent or decided. Go back to see where it is.", Tone.Warning)
                    SecondaryButton("Back", ctx.pop, Modifier.fillMaxWidth())
                    return@Column
                }
                else -> LoadContent(existing, "Loading the draft…") { }
            }
            if (!filled) return@Column
        }
        OutlinedTextField(title, { title = it }, label = { Text("Title (optional)") }, placeholder = { Text("Client visit, October") }, modifier = Modifier.fillMaxWidth().testTag("claim-title"))
        LoadContent(types, "Loading claim types…") { list ->
            if (list.items.isEmpty()) Notice("You have no claim types available. Ask HR.", Tone.Warning)
            lines.forEachIndexed { index, line ->
                ClaimLineEditor(ctx, index, line, list.items, onRemove = if (lines.size > 1) ({ lines.remove(line) }) else null)
            }
            LinkButton("Add another item", { lines.add(LineDraft(ClaimLineValues(date = lines.last().date.toString()))) }, Modifier.testTag("claim-add-line"))
        }
        val total = ClaimForm.total(lines.map { it.values() })
        CrowCard {
            KeyValueRow("Total", Formats.money(total), numeric = true, strong = true, spoken = Formats.moneySpoken(total), modifier = Modifier.testTag("claim-total"))
            if (lines.any { it.currency != "SGD" }) Text("Foreign amounts are converted at the rates you entered, rounded half-up to the cent.", style = MaterialTheme.typography.bodySmall, color = Crow.colors.muted)
        }
        error?.let { Notice(it, Tone.Danger, Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
        fun save(submit: Boolean) {
            val built = mutableListOf<ClaimLineInput>()
            var ok = true
            for (line in lines) {
                line.error = if (line.uploading) "Wait for the receipt to finish uploading." else null
                if (line.error != null) { ok = false; continue }
                when (val check = ClaimForm.check(line.values(), submit)) {
                    is ClaimForm.Check.Problem -> { line.error = check.message; ok = false }
                    is ClaimForm.Check.Ok -> built += check.line
                }
            }
            if (!ok) { error = "Check the items marked below."; return }
            error = null
            saving = if (submit) "submit" else "draft"
            scope.launch {
                var savedDraft = false
                try {
                    val result = if (editId == null) {
                        ctx.api.post("/api/v1/claims", ClaimInput(title.trim().ifEmpty { null }, built, submit), ClaimInput.serializer(), ClaimDetail.serializer())
                    } else {
                        val updated = ctx.api.put("/api/v1/claims/$editId", ClaimUpdate(title.trim().ifEmpty { null }, built), ClaimUpdate.serializer(), ClaimDetail.serializer())
                        savedDraft = true
                        if (submit) ctx.api.postEmpty("/api/v1/claims/$editId/submit", ClaimDetail.serializer()) else updated
                    }
                    done = ClaimSaved(result.id, result.status, result.claimNumber, result.totalCents)
                } catch (e: ApiException) {
                    error = e.message + if (savedDraft) " Your changes are saved in the draft." else ""
                } catch (e: Exception) {
                    error = e.userMessage() + if (savedDraft) " Your changes are saved in the draft." else ""
                }
                saving = null
            }
        }
        PrimaryButton("Submit claim", { save(true) }, Modifier.fillMaxWidth().testTag("submit-claim"), loading = saving == "submit", enabled = saving == null)
        SecondaryButton(if (editId == null) "Save for later" else "Save draft", { save(false) }, Modifier.fillMaxWidth().testTag("save-claim-draft"), enabled = saving == null)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ClaimLineEditor(ctx: ScreenContext, index: Int, line: LineDraft, types: List<ClaimTypeOption>, onRemove: (() -> Unit)?) {
    val scope = rememberCoroutineScope()
    val capture = ctx.graph.receiptCamera.rememberCapture(onError = { line.error = it }) { file ->
        if (file == null) return@rememberCapture
        line.error = null
        line.uploading = true
        scope.launch {
            try {
                // Decoding a 12 MP photo on the main thread froze the screen for a moment.
                val bytes = withContext(Dispatchers.Default) { Images.compressForUpload(file) }
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
            if (onRemove != null) LinkButton("Remove", onRemove, Modifier.semantics { contentDescription = "Remove item ${index + 1}" })
        }
        var expanded by remember { mutableStateOf(false) }
        // A draft's type that is no longer offered stays listed so the line still reads right.
        val options = types + listOfNotNull(line.type?.takeIf { t -> types.none { it.id == t.id } })
        ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
            OutlinedTextField(
                value = line.type?.name ?: "", onValueChange = {}, readOnly = true,
                label = { Text("Type") }, placeholder = { Text("Choose a claim type") },
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
                modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable).testTag("claim-type-$index"),
            )
            ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                options.forEach { t -> DropdownMenuItem(text = { Text(t.name) }, onClick = { line.type = t; expanded = false }) }
            }
        }
        line.type?.receiptHint?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Crow.colors.muted, modifier = Modifier.padding(top = 4.dp)) }
        DateField("Date of expense", line.date, Modifier.padding(top = 8.dp)) { line.date = it }
        OutlinedTextField(line.merchant, { line.merchant = it }, label = { Text("Paid to") }, placeholder = { Text("Grab, Kopitiam…") }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp).testTag("claim-merchant-$index"))
        OutlinedTextField(line.description, { line.description = it }, label = { Text("What for (optional)") }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
        // Side by side normally; stacked at large font sizes so labels never wrap mid-word.
        val stacked = androidx.compose.ui.platform.LocalDensity.current.fontScale > 1.3f
        val currencyField = @Composable { m: Modifier -> CurrencyField(line, index, m) }
        val exponent = ClaimMoney.exponentOf(line.currency)
        val amountField = @Composable { m: Modifier ->
            OutlinedTextField(
                line.amount, { line.amount = it }, label = { Text(if (line.currency == "SGD") "Amount (S$)" else "Amount (${line.currency})") }, singleLine = true,
                placeholder = { Text(if (exponent == 0) "5000" else "0.00") },
                keyboardOptions = KeyboardOptions(keyboardType = if (exponent == 0) KeyboardType.Number else KeyboardType.Decimal),
                modifier = m.testTag("claim-amount-$index"),
                textStyle = Numeric,
            )
        }
        if (stacked) {
            currencyField(Modifier.fillMaxWidth().padding(top = 8.dp))
            amountField(Modifier.fillMaxWidth().padding(top = 8.dp))
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                currencyField(Modifier.weight(1f))
                amountField(Modifier.weight(1.6f))
            }
        }
        if (line.currency != "SGD") {
            OutlinedTextField(
                line.rate, { line.rate = it.trim() }, label = { Text("Rate: S$ per 1 ${line.currency}") }, singleLine = true,
                placeholder = { Text("0.301234") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp).testTag("claim-rate-$index"), textStyle = Numeric,
            )
            val sgd = ClaimForm.sgdCents(line.values())
            Text(
                "= ${sgd?.let(Formats::money) ?: "S$ —"}",
                style = Numeric.copy(fontSize = MaterialTheme.typography.titleMedium.fontSize, fontWeight = FontWeight.SemiBold),
                modifier = Modifier.padding(top = 8.dp).testTag("claim-sgd-$index").semantics {
                    contentDescription = sgd?.let { "In Singapore dollars: ${Formats.moneySpoken(it)}" } ?: "The Singapore dollar amount shows once the amount and rate are filled in"
                },
            )
            Text("Use the rate on your card statement. Rounded half-up to the cent.", style = MaterialTheme.typography.bodySmall, color = Crow.colors.muted)
        }
        line.receipts.toList().forEach { r ->
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 8.dp)) {
                Text("Receipt: ${r.name}", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f).testTag("receipt-attached"))
                LinkButton("Remove", { line.receipts.remove(r) }, Modifier.semantics { contentDescription = "Remove receipt ${r.name}" })
            }
        }
        SecondaryButton(
            if (line.uploading) "Uploading receipt…" else if (line.receipts.isEmpty()) "Photograph receipt" else "Add another photo",
            capture, Modifier.fillMaxWidth().padding(top = 8.dp).testTag("receipt-$index"), enabled = !line.uploading,
        )
        FieldError(line.error)
    }
}

/** The currency of a line: the web form's list, plus a draft's own currency if it isn't on it. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CurrencyField(line: LineDraft, index: Int, modifier: Modifier) {
    var expanded by remember { mutableStateOf(false) }
    val options = ClaimMoney.CURRENCIES + listOfNotNull(
        line.currency.takeIf { code -> ClaimMoney.CURRENCIES.none { it.code == code } }?.let { ClaimMoney.Currency(it, ClaimMoney.exponentOf(it), it) },
    )
    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }, modifier = modifier) {
        OutlinedTextField(
            value = line.currency, onValueChange = {}, readOnly = true, singleLine = true,
            label = { Text("Currency") }, textStyle = Numeric,
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
            modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable).testTag("claim-currency-$index"),
        )
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { c ->
                DropdownMenuItem(
                    text = { Text("${c.code} · ${c.label}") },
                    onClick = {
                        if (c.code != line.currency) {
                            line.currency = c.code
                            if (c.code == "SGD") line.rate = ""
                        }
                        expanded = false
                    },
                    modifier = Modifier.testTag("currency-${c.code}"),
                )
            }
        }
    }
}
