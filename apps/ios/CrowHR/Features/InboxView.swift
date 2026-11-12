import SwiftUI

/// Who sees the Approvals segment.
enum ApprovalsAccess {
    /// Managers and admins always; anyone else while tasks wait for them (a reporting-line
    /// manager without the role, a named approver, out-of-office cover). Role alone hid real tasks.
    static func shows(featureAvailable: Bool, mayApprove: Bool, tasksWaiting: Int?) -> Bool {
        featureAvailable && (mayApprove || (tasksWaiting ?? 0) > 0)
    }

    /// The waiting task a notification is about: by task id, or by its request's id.
    static func task(for target: AppTarget?, in tasks: [ApprovalTask]) -> ApprovalTask? {
        switch target {
        case .approvalTask(let id): tasks.first { $0.taskId == id }
        case .approvalRequest(let id): tasks.first { $0.requestId == id }
        default: nil
        }
    }

    static let notWaiting = "That request isn't waiting for you any more: it was decided, withdrawn or passed on."
}

struct InboxView: View {
    @Environment(AppModel.self) private var model
    @Environment(Session.self) private var session
    @State private var segment: LocalNotice.Route = .notifications
    /// Approvals were shown in this visit: they stay after the last task is decided, so the
    /// list can say what was done instead of the segment vanishing.
    @State private var shownApprovals = false
    /// The task or request a notification is about, for the approvals list to open.
    @State private var openApproval: AppTarget?
    /// A notification chose the segment in this visit: it isn't switched back automatically.
    @State private var segmentFromTarget = false

    private var showsApprovals: Bool {
        shownApprovals || ApprovalsAccess.shows(featureAvailable: session.isAvailable(.approvals), mayApprove: session.me?.mayApprove ?? false,
                                                tasksWaiting: session.approvalTasksWaiting)
    }

    var body: some View {
        VStack(spacing: 0) {
            if showsApprovals {
                SegmentedChoice(title: "Inbox", options: [(id: LocalNotice.Route.approvals, name: "Approvals"), (id: .notifications, name: "Notifications")], selection: $segment)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .crowReadable()
                    .accessibilityIdentifier("inbox.segment")
                Divider().overlay(Crow.hairline)
            }
            // Each list sets its own column: approvals widen to sit beside the decision on an iPad.
            if showsApprovals && segment == .approvals {
                ApprovalsView(open: $openApproval)
            } else {
                NotificationsView()
            }
        }
        .background(Crow.background.ignoresSafeArea())
        .navigationTitle("Inbox")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { applyTarget() }
        .task { await session.refreshApprovalTasks() }
        .onChange(of: model.pendingTarget) { _, _ in applyTarget() }
        .onChange(of: session.me) { _, me in if me?.mayApprove == true && !segmentFromTarget { segment = .approvals } }
        // Tasks found for someone without an approver role: open them, once.
        .onChange(of: showsApprovals) { _, shows in
            guard shows, !shownApprovals else { return }
            shownApprovals = true
            if !segmentFromTarget || openApproval != nil { segment = .approvals }
        }
    }

    /// Takes a notification's target meant for the inbox: the approvals segment (with the task to
    /// open) or the notifications list. Without one, approvers start on Approvals.
    private func applyTarget() {
        if showsApprovals { shownApprovals = true }
        if let t = model.pendingTarget, t.tab == .inbox {
            model.pendingTarget = nil
            segmentFromTarget = true
            switch t {
            case .notifications:
                segment = .notifications
            case .approvalTask, .approvalRequest:
                openApproval = t
                segment = .approvals
            default:
                segment = .approvals
            }
        } else if showsApprovals && !segmentFromTarget {
            segment = .approvals
        }
    }
}

/// What came of a decision, for the list to say once it has reloaded.
enum DecisionOutcome: Equatable {
    case decided(String)
    /// Someone else decided first, or the request was withdrawn: nothing was changed.
    case stale(String)
}

/// The approvals inbox. On a phone (and narrow iPad windows) a list whose rows open the decision
/// in a sheet; on an iPad with room, the list beside the chosen request's decision, the first one
/// open at first, as payslips do.
struct ApprovalsView: View {
    @Environment(Session.self) private var session
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var typeSize
    /// A task a notification is about: opened once the list has it.
    @Binding var open: AppTarget?
    @State private var state: LoadState<[ApprovalTask]> = .loading
    /// The task in the decision sheet (list only).
    @State private var selected: ApprovalTask?
    /// The task beside the list (side by side).
    @State private var chosenID: ApprovalTask.ID?
    @State private var notice: (text: String, tone: Tone)?
    @State private var width: CGFloat = 0
    @ScaledMetric(relativeTo: .body) private var listWidth: CGFloat = 360

    private var sideBySide: Bool {
        sizeClass == .regular && CrowLayout.approvalsSideBySide(width: width, accessibilityText: typeSize.isAccessibilitySize)
    }

    var body: some View {
        AsyncContent(state: $state, load: load) { tasks in
            if sideBySide && !tasks.isEmpty {
                HStack(spacing: 0) {
                    list(tasks)
                        .frame(width: min(listWidth, 480))
                    Divider().overlay(Crow.hairline)
                    detail(tasks)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            } else {
                list(tasks)
            }
        }
        .crowScreen(maxWidth: sideBySide ? CrowLayout.wideWidth : CrowLayout.readableWidth)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .sheet(item: $selected) { t in
            DecisionSheet(task: t) { decided($0) }
        }
        .onChange(of: state.value?.map(\.id), initial: true) { _, _ in
            openTargetIfLoaded()
            chooseIfSideBySide()
        }
        .onChange(of: open) { _, _ in openTargetIfLoaded() }
        .onChange(of: sideBySide) { _, wide in
            // A sheet open when the window widens moves beside the list.
            if wide, let open = selected {
                chosenID = open.id
                selected = nil
            }
            chooseIfSideBySide()
        }
    }

    private func list(_ tasks: [ApprovalTask]) -> some View {
        RowsScreen {
            if let notice {
                Notice(text: notice.text, tone: notice.tone, systemImage: notice.tone == .success ? "checkmark.circle" : "info.circle")
                    .padding(.horizontal, 16)
                    .padding(.top, 16)
                    .accessibilityIdentifier("approvals.notice")
            }
            if tasks.isEmpty {
                EmptyStateView(title: "Nothing to approve", message: "Requests that need your decision appear here.", systemImage: "checkmark.circle")
                    .padding(.top, 24)
            } else {
                RowGroup {
                    ForEach(tasks) { t in
                        // Beside the list, the open request's row is kuning-50 and has no chevron.
                        let open = sideBySide && chosenID == t.id
                        Button { choose(t) } label: { ApprovalRow(task: t) }
                            .buttonStyle(sideBySide ? RowButtonStyle.crowRow : RowButtonStyle.crowNavigationRow)
                            .background(open ? Crow.kuningSoft : Color.clear)
                            .accessibilityAddTraits(open ? .isSelected : [])
                            .accessibilityIdentifier("approval.row")
                    }
                }
            }
        }
        .refreshable { await reload() }
    }

    @ViewBuilder private func detail(_ tasks: [ApprovalTask]) -> some View {
        if let id = chosenID, let t = tasks.first(where: { $0.id == id }) {
            DecisionForm(task: t) { decided($0) }
                .id(t.id)
        } else {
            EmptyStateView(title: "Choose a request", message: "The request you choose in the list opens here.", systemImage: "checkmark.circle")
                .frame(maxHeight: .infinity)
        }
    }

    private func choose(_ t: ApprovalTask) {
        notice = nil
        if sideBySide { chosenID = t.id } else { selected = t }
    }

    /// Opens the task a notification is about, or says it no longer waits.
    private func openTargetIfLoaded() {
        guard let target = open, let tasks = state.value else { return }
        open = nil
        if let t = ApprovalsAccess.task(for: target, in: tasks) {
            choose(t)
        } else {
            notice = (ApprovalsAccess.notWaiting, .warning)
        }
    }

    /// Side by side, keeps a request open: the first one at first, and the next one after a
    /// decision took the open one off the list.
    private func chooseIfSideBySide() {
        guard sideBySide, let tasks = state.value else { return }
        if chosenID == nil || !tasks.contains(where: { $0.id == chosenID }) { chosenID = tasks.first?.id }
    }

    private func decided(_ outcome: DecisionOutcome) {
        switch outcome {
        case .decided(let m): notice = (m, .success)
        case .stale(let m): notice = (m, .warning)
        }
        Task { await reload() }
    }

    private func load() async throws -> [ApprovalTask] {
        let tasks = try await (session.api.get("/api/v1/approvals/tasks") as ApprovalTaskList).items
        session.approvalTasksWaiting = tasks.count
        return tasks
    }

    private func reload() async {
        do { state = .loaded(try await load()) } catch { state.fail(error) }
    }
}

struct ApprovalRow: View {
    let task: ApprovalTask
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            AdaptiveRow {
                Text(task.subjectLabel.uppercased()).font(CrowFont.mono(.caption2, weight: .medium)).foregroundStyle(Crow.muted)
                    .fixedSize(horizontal: false, vertical: true)
            } trailing: {
                if task.overdueDays > 0 { StatusChip(text: "\(task.overdueDays)d overdue", tone: .danger) }
            }
            Text(task.title).font(CrowFont.body(.body, weight: .medium)).foregroundStyle(Crow.ink)
                .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
            Text("\(task.requester.name) · \(submitted) · step \(task.step.position) of \(task.step.of)")
                .font(CrowFont.mono(.caption)).foregroundStyle(Crow.muted)
                .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }

    private var submitted: String { Fmt.parseInstant(task.submittedAt).map(Fmt.date) ?? task.submittedAt }
}

/// The decision in a sheet (phone, narrow iPad windows).
struct DecisionSheet: View {
    @Environment(\.dismiss) private var dismiss
    let task: ApprovalTask
    let onDone: (DecisionOutcome) -> Void

    var body: some View {
        NavigationStack {
            DecisionForm(task: task) { outcome in
                onDone(outcome)
                dismiss()
            }
            .navigationTitle("Decision")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction) } }
        }
    }
}

/// Approve or reject, with what is being decided: the request's summary (amounts, dates, reason,
/// balance or cap) and its comments, from the request itself. Rejecting needs a comment, as on the
/// web.
struct DecisionForm: View {
    @Environment(Session.self) private var session
    let task: ApprovalTask
    let onDone: (DecisionOutcome) -> Void
    @State private var detail: LoadState<ApprovalRequestDetail> = .loading
    @State private var comment = ""
    @State private var busy: String?
    @State private var error: String?
    @State private var needsComment = false
    @FocusState private var commentFocused: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    AdaptiveRow {
                        Text(task.subjectLabel.uppercased()).font(CrowFont.mono(.caption, weight: .medium)).foregroundStyle(Crow.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    } trailing: {
                        if task.overdueDays > 0 { StatusChip(text: "\(task.overdueDays)d overdue", tone: .danger) }
                    }
                    Text(task.title).font(CrowFont.mono(.title3, weight: .semibold)).fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                        .accessibilityIdentifier("decision.title")
                    Text("From \(task.requester.name) · \(task.step.label)").font(CrowFont.body(.subheadline)).foregroundStyle(Crow.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                details
                VStack(alignment: .leading, spacing: 6) {
                    SectionLabel("Comment")
                    TextField("Add a comment", text: $comment, axis: .vertical)
                        .lineLimit(3...6)
                        .font(CrowFont.body())
                        .focused($commentFocused)
                        .crowFieldBox(focused: commentFocused, invalid: needsComment)
                        .accessibilityIdentifier("decision.comment")
                    if needsComment {
                        Text("Add a comment to reject. \(task.requester.name) sees it, so say what to change.")
                            .font(CrowFont.body(.footnote)).foregroundStyle(Crow.danger)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("decision.commentRequired")
                    }
                }
                if let error { Notice(text: error, tone: .danger, systemImage: "exclamationmark.triangle") }
                Button { Task { await decide("approve") } } label: {
                    if busy == "approve" { ProgressView().tint(Crow.onKuning) } else { Text("Approve") }
                }
                .buttonStyle(.crowPrimary)
                .disabled(busy != nil)
                .accessibilityLabel("Approve")
                .accessibilityIdentifier("decision.approve")
                Button { Task { await decide("reject") } } label: {
                    if busy == "reject" { ProgressView() } else { Text("Reject") }
                }
                .buttonStyle(.crowDanger)
                .disabled(busy != nil)
                .accessibilityLabel("Reject")
                .accessibilityIdentifier("decision.reject")
            }
            .padding(20)
        }
        .scrollDismissesKeyboard(.interactively)
        .crowScreen()
        // The keyboard covers Approve and Reject: Done puts it away, as on the other forms.
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { commentFocused = false }
            }
        }
        .task {
            do { detail = .loaded(try await session.api.get("/api/v1/approvals/requests/\(task.requestId)")) } catch { detail.fail(error) }
        }
    }

    @ViewBuilder private var details: some View {
        switch detail {
        case .loading:
            HStack(spacing: 10) {
                ProgressView()
                Text("Loading details…").font(CrowFont.body(.footnote)).foregroundStyle(Crow.muted)
            }
            .accessibilityElement(children: .combine)
        case .failed:
            Text("The details didn't load. You can still decide, or open the request in Crow HR on the web.")
                .font(CrowFont.body(.footnote)).foregroundStyle(Crow.muted)
                .fixedSize(horizontal: false, vertical: true)
        case .loaded(let d):
            if let s = d.summary, !(s.lines.isEmpty && s.context.isEmpty) {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(s.lines, id: \.self) { DetailLine(line: $0) }
                    if !s.context.isEmpty {
                        Divider().overlay(Crow.hairline)
                        ForEach(s.context, id: \.self) { DetailLine(line: $0, muted: true) }
                    }
                }
                .crowCard()
                .accessibilityIdentifier("decision.details")
            }
            if !d.comments.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    SectionLabel("Comments")
                    ForEach(d.comments) { c in
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(c.author) · \(Fmt.parseInstant(c.createdAt).map(Fmt.dateTime) ?? "")")
                                .font(CrowFont.mono(.caption)).foregroundStyle(Crow.muted)
                                .fixedSize(horizontal: false, vertical: true)
                            Text(c.body).font(CrowFont.body(.subheadline)).fixedSize(horizontal: false, vertical: true)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            }
        }
    }

    private func decide(_ decision: String) async {
        let trimmed = comment.trimmingCharacters(in: .whitespacesAndNewlines)
        if decision == "reject" && trimmed.isEmpty {
            needsComment = true
            commentFocused = true
            return
        }
        needsComment = false
        error = nil
        busy = decision
        defer { busy = nil }
        do {
            let r: DecisionResult = try await session.api.post("/api/v1/approvals/tasks/\(task.taskId)/decision", json: Decision(decision: decision, comment: trimmed.isEmpty ? nil : trimmed))
            onDone(.decided("\(r.outcome == "rejected" ? "Rejected" : "Approved"): \(task.title)"))
        } catch let e as APIError where e.code == "already_decided" || e.code == "not_found" {
            // Decided by someone else (or withdrawn) meanwhile: the list must drop it.
            onDone(.stale(e.message))
        } catch {
            self.error = APIError.from(error, host: "").message
        }
    }
}

/// A label above its value, wrapping at any size (values such as a claim line can be long).
private struct DetailLine: View {
    let line: ApprovalRequestDetail.Line
    var muted = false

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(line.label).font(CrowFont.body(.footnote)).foregroundStyle(Crow.muted)
                .fixedSize(horizontal: false, vertical: true)
            Text(line.value).font(CrowFont.body(muted ? .subheadline : .body)).foregroundStyle(muted ? Crow.muted : Crow.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

struct NotificationsView: View {
    @Environment(AppModel.self) private var model
    @Environment(Session.self) private var session
    @State private var state: LoadState<NotificationPage> = .loading

    var body: some View {
        AsyncContent(state: $state, load: load) { page in
            RowsScreen {
                if page.items.isEmpty {
                    EmptyStateView(title: "No notifications", message: "Updates about your requests, payslips and rosters appear here.", systemImage: "bell")
                        .padding(.top, 24)
                } else {
                    RowGroup {
                        ForEach(page.items) { n in
                            // Opens what it is about, as on the web; one the app has no screen
                            // for is only marked read.
                            let opens = AppTarget.from(link: n.link) != .notifications
                            Button { Task { await openItem(n) } } label: { NotificationRow(item: n) }
                                .buttonStyle(opens ? RowButtonStyle.crowNavigationRow : RowButtonStyle.crowRow)
                                .accessibilityValue(n.readAt == nil ? "Unread" : "")
                                .accessibilityHint(opens ? "Opens it" : n.readAt == nil ? "Marks it read" : "")
                                .accessibilityIdentifier("notification.row")
                        }
                    }
                }
            }
            .refreshable { await reload() }
            .toolbar {
                if page.unread > 0 {
                    ToolbarItem(placement: .primaryAction) {
                        Button("Mark all read") { Task { await markAllRead() } }
                    }
                }
            }
        }
        .crowScreen()
    }

    private func load() async throws -> NotificationPage {
        let page: NotificationPage = try await session.api.get("/api/v1/notifications", query: [URLQueryItem(name: "pageSize", value: "50"), URLQueryItem(name: "sort", value: "-createdAt")])
        // What the user has seen here is not announced later by the background refresh.
        await model.refresher(for: session).markAllSeen(listCursor: page.cursor, listHadCursor: page.cursor != nil)
        model.setUnread(page.unread)
        return page
    }

    private func reload() async {
        do { state = .loaded(try await load()) } catch { state.fail(error) }
    }

    /// Marks it read, then opens its item (`AppTarget`), as the web's bell does.
    private func openItem(_ n: InboxNotification) async {
        if n.readAt == nil {
            try? await session.api.postNoContent("/api/v1/notifications/\(n.id)/read")
            await reload()
        }
        let target = AppTarget.from(link: n.link)
        if target != .notifications { model.open(target) }
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
                Text(item.title).font(CrowFont.body(.body, weight: item.readAt == nil ? .medium : .regular)).foregroundStyle(Crow.ink)
                    .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                if let body = item.body {
                    Text(body).font(CrowFont.body(.subheadline)).foregroundStyle(Crow.muted)
                        .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                }
                Text(Fmt.parseInstant(item.createdAt).map(Fmt.dateTime) ?? "").font(CrowFont.mono(.caption)).foregroundStyle(Crow.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}
