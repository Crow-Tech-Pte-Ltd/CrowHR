package crowtech.crowhr.ui.screens

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.view.WindowManager
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import crowtech.crowhr.api.Items
import crowtech.crowhr.api.PayLine
import crowtech.crowhr.api.Payslip
import crowtech.crowhr.api.PayslipSummary
import crowtech.crowhr.core.Formats
import crowtech.crowhr.ui.Route
import crowtech.crowhr.ui.ScreenContext
import crowtech.crowhr.ui.components.CrowCard
import crowtech.crowhr.ui.components.EmptyState
import crowtech.crowhr.ui.components.Hairline
import crowtech.crowhr.ui.components.KeyValueRow
import crowtech.crowhr.ui.components.Label
import crowtech.crowhr.ui.components.LoadContent
import crowtech.crowhr.ui.components.Notice
import crowtech.crowhr.ui.components.ScreenTitle
import crowtech.crowhr.ui.components.SecondaryButton
import crowtech.crowhr.ui.components.SectionTitle
import crowtech.crowhr.ui.components.StatusChip
import crowtech.crowhr.ui.components.Tone
import crowtech.crowhr.ui.components.rememberLoader
import crowtech.crowhr.ui.components.userMessage
import crowtech.crowhr.ui.theme.Crow
import crowtech.crowhr.ui.theme.Numeric
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

private val PAYSLIP_LIST = Items.serializer(PayslipSummary.serializer())

/** FLAG_SECURE while a payslip screen is visible: no screenshots, blank in the app switcher. */
@Composable
fun SecureScreen() {
    val activity = LocalContext.current as? Activity ?: return
    DisposableEffect(Unit) {
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        onDispose { activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE) }
    }
}

@Composable
fun PayslipsScreen(ctx: ScreenContext) {
    SecureScreen()
    val key = ctx.connection.key
    val loader = rememberLoader(key, cached = { ctx.graph.cache.get(key, "payslips", PAYSLIP_LIST) }) {
        ctx.api.get("/api/v1/payslips", PAYSLIP_LIST).also { ctx.graph.cache.put(key, "payslips", PAYSLIP_LIST, it) }
    }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ScreenTitle("Payslips", "Released by HR, newest first.")
        LoadContent(loader, "Loading payslips…") { list ->
            if (list.items.isEmpty()) {
                EmptyState("No payslips yet", "Your payslips appear here when HR releases them.")
            } else {
                list.items.forEach { p ->
                    CrowCard(onClick = { ctx.push(Route.PayslipDetail(p.id)) }, modifier = Modifier.testTag("payslip-${p.id}")) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(p.title, style = MaterialTheme.typography.titleSmall)
                                Text("Paid ${Formats.date(p.payDate)}", style = MaterialTheme.typography.bodySmall, color = Crow.colors.muted)
                                if (p.revised) StatusChip("Revised", Tone.Warning, Modifier.padding(top = 4.dp))
                            }
                            Column(horizontalAlignment = Alignment.End) {
                                Label("Net pay")
                                Text(Formats.money(p.netPayableCents), style = Numeric.copy(fontSize = MaterialTheme.typography.titleMedium.fontSize, fontWeight = FontWeight.SemiBold))
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun PayslipDetailScreen(ctx: ScreenContext, id: String) {
    SecureScreen()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var downloading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    // Never cached: details and PDFs are fetched each time (add-mobile-apps design decision 4).
    val loader = rememberLoader(id) { ctx.api.get("/api/v1/payslips/$id", Payslip.serializer()) }
    val shareDir = remember { File(context.cacheDir, "share") }
    DisposableEffect(Unit) { onDispose { shareDir.deleteRecursively() } }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        LoadContent(loader, "Loading payslip…") { p ->
            ScreenTitle(p.title, "${Formats.date(p.periodStart)} to ${Formats.date(p.periodEnd)} · paid ${Formats.date(p.payDate)}")
            CrowCard(border = 2.dp) {
                Label("Net pay")
                Text(
                    Formats.money(p.netPayableCents),
                    style = Numeric.copy(fontSize = MaterialTheme.typography.displaySmall.fontSize, fontWeight = FontWeight.SemiBold),
                    modifier = Modifier.testTag("net-pay"),
                )
                Text("${p.employer.legalName} · ${p.employee.name} · ${p.employee.idMasked}", style = MaterialTheme.typography.bodySmall, color = Crow.colors.muted)
            }
            PaySection("Earnings", buildList {
                p.basic?.let { add(PayLine("Basic pay", it.amountCents, it.detail)) }
                addAll(p.allowances)
                p.overtime?.let { add(PayLine("Overtime (${it.hours} h)", it.payCents)) }
                addAll(p.additional)
            }, "Gross pay", p.grossCents)
            PaySection("Deductions", p.deductions, "Total deductions", p.totalDeductionsCents)
            if (p.reimbursements.isNotEmpty()) PaySection("Reimbursements", p.reimbursements, null, null)
            CrowCard {
                KeyValueRow("Net pay", Formats.money(p.netCents), numeric = true, strong = true)
                if (p.netPayableCents != p.netCents) KeyValueRow("Paid to you", Formats.money(p.netPayableCents), numeric = true, strong = true)
                KeyValueRow("Employer CPF", Formats.money(p.employerCpfCents), numeric = true)
                p.cpf?.rateTableLabel?.let { KeyValueRow("CPF rates", it) }
            }
            error?.let { Notice(it, Tone.Danger) }
            SecondaryButton(if (downloading) "Downloading…" else "Download PDF", {
                downloading = true
                error = null
                scope.launch {
                    try {
                        val bytes = ctx.api.bytes("/api/v1/payslips/$id/pdf")
                        val file = withContext(Dispatchers.IO) {
                            shareDir.mkdirs()
                            File(shareDir, "payslip-${p.payDate}.pdf").also { it.writeBytes(bytes) }
                        }
                        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
                        val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/pdf").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        try {
                            context.startActivity(Intent.createChooser(view, "Open payslip"))
                        } catch (_: ActivityNotFoundException) {
                            error = "No app on this phone can open PDFs."
                        }
                    } catch (e: Exception) {
                        error = e.userMessage()
                    }
                    downloading = false
                }
            }, Modifier.fillMaxWidth().testTag("download-pdf"), enabled = !downloading)
            Text("The PDF is downloaded only when you ask and isn't kept on this phone.", style = MaterialTheme.typography.bodySmall, color = Crow.colors.muted)
        }
    }
}

@Composable
private fun PaySection(title: String, lines: List<PayLine>, totalLabel: String?, totalCents: Long?) {
    SectionTitle(title)
    CrowCard {
        if (lines.isEmpty()) Text("None", style = MaterialTheme.typography.bodyMedium, color = Crow.colors.muted)
        lines.forEach { l ->
            KeyValueRow(l.label, Formats.money(l.amountCents), numeric = true)
            l.detail?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Crow.colors.muted, textAlign = TextAlign.Start) }
        }
        if (totalLabel != null && totalCents != null) {
            Hairline(Modifier.padding(vertical = 4.dp))
            KeyValueRow(totalLabel, Formats.money(totalCents), numeric = true, strong = true)
        }
    }
}
