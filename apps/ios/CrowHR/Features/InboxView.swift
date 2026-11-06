import SwiftUI

struct InboxView: View {
    @Environment(AppModel.self) private var model
    @Environment(Session.self) private var session
    @State private var segment: LocalNotice.Route = .notifications

    private var showsApprovals: Bool { session.isAvailable(.approvals) && (session.me?.mayApprove ?? false) }

    var body: some View {
        VStack(spacing: 0) {
            if showsApprovals {
                Picker("Inbox", selection: $segment) {
                    Text("Approvals").tag(LocalNotice.Route.approvals)
                    Text("Notifications").tag(LocalNotice.Route.notifications)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .accessibilityIdentifier("inbox.segment")
            }
            if showsApprovals && segment == .approvals {
                ApprovalsView()
            } else {
                NotificationsView()
            }
        }
        .crowScreen()
        .navigationTitle("Inbox")
        .onAppear { applyRoute() }
        .onChange(of: model.route) { _, _ in applyRoute() }
        .onChange(of: session.me) { _, me in if me?.mayApprove == true && model.route == nil { segment = .approvals } }
    }

    private func applyRoute() {
        if let r = model.route {
            segment = r
            model.route = nil
        } else if showsApprovals {
            segment = .approvals
        }
    }
}

struct ApprovalsView: View {
    @Environment(Session.self) private var session
    @State private var state: LoadState<[ApprovalTask]> = .loading
    @State private var selected: ApprovalTask?

    var body: some View {
        AsyncContent(state: $state, load: load) { tasks in
            if tasks.isEmpty {
                EmptyStateView(title: "Nothing to approve", message: "Requests that need your decision appear here.", systemImage: "checkmark.circle")
            } else {
                List(tasks) { t in
                    Button { selected = t } label: { ApprovalRow(task: t) }
                        .accessibilityIdentifier("approval.row")
                }
                .listStyle(.plain)
                .refreshable { await reload() }
            }
        }
        .sheet(item: $selected) { t in
            DecisionSheet(task: t) { Task { await reload() } }
        }
    }

    private func load() async throws -> [ApprovalTask] {
        try await (session.api.get("/api/v1/approvals/tasks") as ApprovalTaskList).items
    }

    private func reload() async {
        do { state = .loaded(try await load()) } catch { state = .failed(APIError.from(error, host: "")) }
    }
}

struct ApprovalRow: View {
    let task: ApprovalTask
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(task.subjectLabel.uppercased()).font(CrowFont.mono(.caption2, weight: .medium)).foregroundStyle(Crow.muted)
                Spacer()
                if task.overdueDays > 0 { StatusChip(text: "\(task.overdueDays)d overdue", tone: .danger) }
            }
            Text(task.title).font(CrowFont.body(.body, weight: .medium)).foregroundStyle(Crow.ink).multilineTextAlignment(.leading)
            Text("\(task.requester.name) · \(submitted) · step \(task.step.position) of \(task.step.of)")
                .font(CrowFont.mono(.caption)).foregroundStyle(Crow.muted)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private var submitted: String { Fmt.parseInstant(task.submittedAt).map(Fmt.date) ?? task.submittedAt }
}

/// Approve or reject. Rejecting needs a comment, as on the web.
struct DecisionSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(Session.self) private var session
    let task: ApprovalTask
    let onDone: () -> Void
    @State private var comment = ""
    @State private var busy = false
    @State private var error: String?
    @State private var needsComment = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(task.subjectLabel.uppercased()).font(CrowFont.mono(.caption, weight: .medium)).foregroundStyle(Crow.muted)
                    Text(task.title).font(CrowFont.mono(.title3, weight: .semibold)).fixedSize(horizontal: false, vertical: true)
                    Text("From \(task.requester.name) · \(task.step.label)").font(CrowFont.body(.subheadline)).foregroundStyle(Crow.muted)
                    VStack(alignment: .leading, spacing: 6) {
                        SectionLabel("Comment")
                        TextField("Add a comment", text: $comment, axis: .vertical)
                            .lineLimit(3...6)
                            .padding(10)
                            .overlay(RoundedRectangle(cornerRadius: Crow.radius).strokeBorder(needsComment ? Crow.danger : Crow.hairline, lineWidth: needsComment ? 2 : 1))
                            .accessibilityIdentifier("decision.comment")
                        if needsComment {
                            Text("Add a comment to reject. The requester sees it, so say what to change.")
                                .font(CrowFont.body(.footnote)).foregroundStyle(Crow.danger)
                                .accessibilityIdentifier("decision.commentRequired")
                        }
                    }
                    if let error { Notice(text: error, tone: .danger, systemImage: "exclamationmark.triangle") }
                    Button("Approve") { Task { await decide("approve") } }
                        .buttonStyle(.crowPrimary)
                        .disabled(busy)
                        .accessibilityIdentifier("decision.approve")
                    Button("Reject") { Task { await decide("reject") } }
                        .buttonStyle(.crowDanger)
                        .disabled(busy)
                        .accessibilityIdentifier("decision.reject")
                }
                .padding(20)
            }
            .crowScreen()
            .navigationTitle("Decision")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }

    private func decide(_ decision: String) async {
        let trimmed = comment.trimmingCharacters(in: .whitespacesAndNewlines)
        if decision == "reject" && trimmed.isEmpty {
            needsComment = true
            return
        }
        needsComment = false
        busy = true
        defer { busy = false }
        do {
            let _: DecisionResult = try await session.api.post("/api/v1/approvals/tasks/\(task.taskId)/decision", json: Decision(decision: decision, comment: trimmed.isEmpty ? nil : trimmed))
            onDone()
            dismiss()
        } catch {
            self.error = APIError.from(error, host: "").message
        }
    }
}

struct NotificationsView: View {
    @Environment(Session.self) private var session
    @State private var state: LoadState<NotificationPage> = .loading

    var body: some View {
        AsyncContent(state: $state, load: load) { page in
            if page.items.isEmpty {
                EmptyStateView(title: "No notifications", message: "Updates about your requests, payslips and rosters appear here.", systemImage: "bell")
            } else {
                List {
                    ForEach(page.items) { n in
                        Button { Task { await markRead(n) } } label: { NotificationRow(item: n) }
                            .accessibilityIdentifier("notification.row")
                    }
                }
                .listStyle(.plain)
                .refreshable { await reload() }
                .toolbar {
                    if page.unread > 0 {
                        ToolbarItem(placement: .primaryAction) {
                            Button("Mark all read") { Task { await markAllRead() } }
                        }
                    }
                }
            }
        }
    }

    private func load() async throws -> NotificationPage {
        try await session.api.get("/api/v1/notifications", query: [URLQueryItem(name: "pageSize", value: "50"), URLQueryItem(name: "sort", value: "-createdAt")])
    }

    private func reload() async {
        do { state = .loaded(try await load()) } catch { state = .failed(APIError.from(error, host: "")) }
    }

    private func markRead(_ n: InboxNotification) async {
        guard n.readAt == nil else { return }
        try? await session.api.postNoContent("/api/v1/notifications/\(n.id)/read")
        await reload()
    }

    private func markAllRead() async {
        try? await session.api.postNoContent("/api/v1/notifications/read-all")
        await reload()
    }
}

struct NotificationRow: View {
    let item: InboxNotification
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Circle().fill(item.readAt == nil ? Crow.kuning : Color.clear)
                .overlay(Circle().strokeBorder(item.readAt == nil ? Crow.strongBorder : Crow.hairline, lineWidth: 1))
                .frame(width: 10, height: 10)
                .padding(.top, 6)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(item.title).font(CrowFont.body(.body, weight: item.readAt == nil ? .medium : .regular)).foregroundStyle(Crow.ink).multilineTextAlignment(.leading)
                if let body = item.body { Text(body).font(CrowFont.body(.subheadline)).foregroundStyle(Crow.muted).multilineTextAlignment(.leading) }
                Text(Fmt.parseInstant(item.createdAt).map(Fmt.dateTime) ?? "").font(CrowFont.mono(.caption)).foregroundStyle(Crow.muted)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityValue(item.readAt == nil ? "Unread" : "")
    }
}
