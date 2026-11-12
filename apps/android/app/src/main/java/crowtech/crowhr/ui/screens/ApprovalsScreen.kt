package crowtech.crowhr.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import crowtech.crowhr.api.ApprovalRequestDetail
import crowtech.crowhr.api.ApprovalTask
import crowtech.crowhr.api.Decision
import crowtech.crowhr.api.DecisionResult
import crowtech.crowhr.api.Items
import crowtech.crowhr.core.Formats
import crowtech.crowhr.ui.ScreenContext
import crowtech.crowhr.ui.ScreenMemory
import crowtech.crowhr.ui.components.CrowCard
import crowtech.crowhr.ui.components.EmptyState
import crowtech.crowhr.ui.components.KeyValueRow
import crowtech.crowhr.ui.components.Label
import crowtech.crowhr.ui.components.LoadContent
import crowtech.crowhr.ui.components.LoadingState
import crowtech.crowhr.ui.components.Notice
import crowtech.crowhr.ui.components.PrimaryButton
import crowtech.crowhr.ui.components.ScreenTitle
import crowtech.crowhr.ui.components.SecondaryButton
import crowtech.crowhr.ui.components.StatusChip
import crowtech.crowhr.ui.components.Tone
import crowtech.crowhr.ui.components.rememberLoader
import crowtech.crowhr.ui.components.userMessage
import crowtech.crowhr.ui.theme.Crow
import kotlinx.coroutines.launch

private val TASKS = Items.serializer(ApprovalTask.serializer())

@Composable
fun ApprovalsScreen(ctx: ScreenContext) {
    val loader = rememberLoader(ctx.connection.key, memoryKey = ScreenMemory.key(ctx.connection.key, "approvals")) {
        ctx.api.get("/api/v1/approvals/tasks", TASKS)
    }
    var open by rememberSaveable { mutableStateOf<String?>(null) }
    var done by rememberSaveable { mutableStateOf<String?>(null) }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ScreenTitle("Approvals", "Requests waiting for your decision.")
        done?.let { Notice(it, Tone.Success) }
        LoadContent(loader, "Loading approvals…") { list ->
            if (list.items.isEmpty()) EmptyState("Nothing to approve", "When someone sends you a request to decide, it appears here.")
            list.items.forEach { task -> key(task.taskId) {
                if (open == task.taskId) {
                    TaskDecision(ctx, task, onClose = { open = null }, onDecided = { message ->
                        open = null
                        done = message
                        loader.reload()
                    })
                } else {
                    CrowCard(onClick = { open = task.taskId; done = null }, modifier = Modifier.testTag("task-${task.taskId}")) {
                        Label(task.subjectLabel.ifBlank { task.subjectType })
                        Text(task.title, style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 2.dp))
                        Text(
                            "${task.requester.name} · sent ${Formats.parseInstant(task.submittedAt)?.let(Formats::dateTime) ?: task.submittedAt}",
                            style = MaterialTheme.typography.bodySmall, color = Crow.colors.muted,
                        )
                        // Wraps at large text sizes ("Covering for …" no longer runs off the card).
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 6.dp)) {
                            task.step?.let { StatusChip("Step ${it.position} of ${it.of}", Tone.Neutral) }
                            if (task.overdueDays > 0) StatusChip("${task.overdueDays} ${if (task.overdueDays == 1) "day" else "days"} overdue", Tone.Warning)
                            if (task.origin == "delegated") StatusChip("Covering for ${task.onBehalfOf ?: "a colleague"}", Tone.Accent)
                            if (task.origin == "escalated") StatusChip("Escalated", Tone.Warning)
                        }
                    }
                }
            } }
        }
    }
}

@Composable
private fun TaskDecision(ctx: ScreenContext, task: ApprovalTask, onClose: () -> Unit, onDecided: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    val detail = rememberLoader(task.requestId) { ctx.api.get("/api/v1/approvals/requests/${task.requestId}", ApprovalRequestDetail.serializer()) }
    var comment by rememberSaveable { mutableStateOf("") }
    var commentError by rememberSaveable { mutableStateOf<String?>(null) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf<String?>(null) }

    fun decide(decision: String) {
        if (decision == "reject" && comment.isBlank()) {
            // Same rule as the web (spec "Manager approves on phone").
            commentError = "Add a comment so ${task.requester.name} knows why it was rejected."
            return
        }
        commentError = null
        error = null
        sending = decision
        scope.launch {
            try {
                val r = ctx.api.post(
                    "/api/v1/approvals/tasks/${task.taskId}/decision",
                    Decision(decision, comment.trim().ifEmpty { null }), Decision.serializer(), DecisionResult.serializer(),
                )
                onDecided(if (r.outcome == "approved") "Approved: ${task.title}" else "Rejected: ${task.title}")
            } catch (e: Exception) {
                error = e.userMessage()
            }
            sending = null
        }
    }

    CrowCard(border = 2.dp, modifier = Modifier.testTag("task-open")) {
        Label(task.subjectLabel.ifBlank { task.subjectType })
        Text(task.title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 2.dp))
        Text("From ${task.requester.name}", style = MaterialTheme.typography.bodySmall, color = Crow.colors.muted)
        when (val d = detail.value) {
            is crowtech.crowhr.ui.components.LoadState.Loading -> LoadingState("Loading details…")
            is crowtech.crowhr.ui.components.LoadState.Failed -> Notice(d.message, Tone.Warning)
            is crowtech.crowhr.ui.components.LoadState.Ready -> d.value.summary?.let { s ->
                Column(Modifier.padding(top = 8.dp)) {
                    s.lines.forEach { KeyValueRow(it.label, it.value) }
                    s.context.forEach { KeyValueRow(it.label, it.value) }
                }
            }
        }
        OutlinedTextField(
            comment, { comment = it; commentError = null },
            label = { Text("Comment") },
            // One message under the field: the hint, or what to fix (announced by TalkBack).
            supportingText = {
                Text(
                    commentError ?: "Required when you reject. ${task.requester.name} will see it.",
                    Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
            },
            isError = commentError != null,
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp).testTag("decision-comment"),
            minLines = 2,
        )
        error?.let { Notice(it, Tone.Danger, Modifier.padding(top = 8.dp).semantics { liveRegion = LiveRegionMode.Polite }) }
        Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 12.dp)) {
            PrimaryButton("Approve", { decide("approve") }, Modifier.fillMaxWidth().testTag("approve"), loading = sending == "approve", enabled = sending == null)
            SecondaryButton("Reject", { decide("reject") }, Modifier.fillMaxWidth().testTag("reject"), tone = Tone.Danger, enabled = sending == null)
            SecondaryButton("Close", onClose, Modifier.fillMaxWidth())
        }
    }
}
