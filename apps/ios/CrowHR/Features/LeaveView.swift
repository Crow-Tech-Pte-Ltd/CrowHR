import PhotosUI
import SwiftUI

struct LeaveData: Sendable {
    let balances: [LeaveBalance]
    let requests: [LeaveRequest]
    /// The sign-in has an employee record (an owner or admin may not): without one there is no
    /// leave of their own.
    var linked = true
    /// For per-child balances ("Paternity leave · Tan Yu Xuan").
    var children: [LeaveChild] = []

    /// "My leave": this person's own requests, newest 50. The list endpoint returns everything
    /// the caller may see (a manager's team, all staff for HR) unless it names the employee, so
    /// there is no query without one.
    static func myRequestsQuery(employeeId: String?) -> [URLQueryItem]? {
        guard let employeeId else { return nil }
        return [URLQueryItem(name: "limit", value: "50"), URLQueryItem(name: "employeeId", value: employeeId)]
    }
}

/// A leave request to open in a sheet (from the team calendar or a notification).
struct LeaveRequestRef: Identifiable, Hashable { let id: String }

/// Leave: "My leave" (balances, own history, apply, withdraw and cancel) and "Calendar" (who is
/// away, the team calendar for managers), as the web's Leave tabs.
struct LeaveView: View {
    enum Segment: Hashable { case mine, calendar }

    @Environment(AppModel.self) private var model
    @Environment(Session.self) private var session
    @State private var segment: Segment = .mine
    @State private var state: LoadState<LeaveData> = .loading
    @State private var applying = false
    @State private var actionError: String?
    @State private var cancelling: LeaveRequest?
    @State private var withdrawing: LeaveRequest?
    @State private var opened: LeaveRequestRef?

    var body: some View {
        VStack(spacing: 0) {
            SegmentedChoice(title: "Leave", options: [(id: Segment.mine, name: "My leave"), (id: .calendar, name: "Calendar")], selection: $segment)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .crowReadable()
                .accessibilityIdentifier("leave.segment")
            Divider().overlay(Crow.hairline)
            if segment == .mine {
                myLeave
            } else {
                TeamCalendarView { opened = LeaveRequestRef(id: $0) }
            }
        }
        .background(Crow.background.ignoresSafeArea())
        .navigationTitle("Leave")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if state.value?.linked != false {
                ToolbarItem(placement: .primaryAction) {
                    Button { applying = true } label: { Label("Apply for leave", systemImage: "plus") }
                        .accessibilityIdentifier("leave.apply")
                }
            }
        }
        .sheet(isPresented: $applying) {
            // Page-sized on an iPad, so the whole form shows; no effect on a phone.
            ApplyLeaveView { Task { await refresh() } }
                .presentationSizing(.page)
        }
        .sheet(item: $opened) { ref in
            LeaveRequestSheet(id: ref.id)
        }
        .alert("Withdraw this request?", isPresented: Binding(get: { withdrawing != nil }, set: { if !$0 { withdrawing = nil } }), presenting: withdrawing) { r in
            Button("Withdraw", role: .destructive) { Task { await withdraw(r) } }
            Button("Keep it", role: .cancel) {}
        } message: { r in
            Text("\(r.type.name), \(Fmt.dayString(r.startDate)). Your approver no longer sees it.")
        }
        .alert("Cancel this leave?", isPresented: Binding(get: { cancelling != nil }, set: { if !$0 { cancelling = nil } }), presenting: cancelling) { r in
            Button("Cancel leave", role: .destructive) { Task { await cancel(r) } }
            Button("Keep it", role: .cancel) {}
        } message: { r in
            Text("\(r.type.name), \(Fmt.dayString(r.startDate)). Your approver is asked to confirm.")
        }
        .onChange(of: model.pendingTarget, initial: true) { _, _ in applyTarget() }
    }

    private var myLeave: some View {
        AsyncContent(state: $state, load: load) { data in
            RowsScreen {
                if let actionError {
                    Notice(text: actionError, tone: .danger, systemImage: "exclamationmark.triangle")
                        .padding(.horizontal, 16)
                        .padding(.top, 16)
                        .accessibilityIdentifier("leave.actionError")
                }
                if !data.linked {
                    EmptyStateView(title: "No employee record", message: "Your sign-in isn't linked to an employee record, so there is no leave to show here. Ask HR to link it.", systemImage: "person.crop.circle.badge.questionmark")
                        .padding(.top, 24)
                } else {
                    let shown = LeaveBalances.shown(data.balances)
                    // The server's year: Singapore's, on the Gregorian calendar.
                    RowGroup(header: "Balances \(Fmt.year(Date()))") {
                        if shown.isEmpty {
                            EmptyStateView(title: "No leave balances", message: "Your company hasn't set up leave for you yet. Ask HR.", systemImage: "calendar")
                        }
                        ForEach(shown) { b in BalanceRow(balance: b, title: LeaveBalances.title(b, children: data.children)).crowRowPadding() }
                    }
                    RowGroup(header: "My leave") {
                        if data.requests.isEmpty {
                            EmptyStateView(title: "No leave yet", message: "Leave you apply for appears here with its status.", systemImage: "calendar.badge.plus")
                        }
                        ForEach(data.requests) { r in requestCell(r) }
                    }
                }
            }
            .refreshable { await refresh() }
        }
        .crowScreen()
    }

    /// A notification about leave: the request opens in a sheet; the calendar or "My leave" shows.
    private func applyTarget() {
        guard let t = model.pendingTarget, t.tab == .leave else { return }
        model.pendingTarget = nil
        switch t {
        case .leaveRequest(let id):
            segment = .mine
            opened = LeaveRequestRef(id: id)
        case .leaveCalendar: segment = .calendar
        default: segment = .mine
        }
    }

    /// A request, with its action as a visible button (List swipe actions don't exist outside
    /// `List`, and a button is easier to find, for VoiceOver too). Both ask before acting.
    private func requestCell(_ r: LeaveRequest) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            LeaveRequestRow(request: r)
            if r.status == "pending" {
                Button("Withdraw") { withdrawing = r }
                    .buttonStyle(.crowCompact)
                    .accessibilityHint("Withdraws your \(r.type.name) request for \(Fmt.dayString(r.startDate))")
                    .accessibilityIdentifier("leave.withdraw")
            } else if r.status == "approved" {
                Button("Cancel leave") { cancelling = r }
                    .buttonStyle(.crowCompact)
                    .accessibilityHint("Asks your approver to cancel \(r.type.name) from \(Fmt.dayString(r.startDate))")
                    .accessibilityIdentifier("leave.cancel")
            }
        }
        .crowRowPadding()
    }

    private func load() async throws -> LeaveData {
        // Whose leave this is comes from `/me`. Loaded without it (a launch with no signal, or
        // before `/me` answered), "My leave" listed everyone a manager or HR may see, with
        // Withdraw and Cancel buttons on other people's requests.
        await model.refreshMeIfNeeded()
        guard let me = session.me else { throw APIError.offline }
        guard let query = LeaveData.myRequestsQuery(employeeId: me.employeeId) else {
            return LeaveData(balances: [], requests: [], linked: false)
        }
        let api = session.api
        async let balances: LeaveBalanceList = api.get("/api/v1/leave/balances")
        async let requests: LeaveRequestList = api.get("/api/v1/leave/requests", query: query)
        // Names for per-child balances only: the list shows without them.
        async let children: LeaveChildList? = try? api.get("/api/v1/leave/children")
        return try await LeaveData(balances: balances.items, requests: requests.items, children: children?.items ?? [])
    }

    private func refresh() async {
        do { state = .loaded(try await load()) } catch { state.fail(error) }
    }

    // The reply isn't decoded: the action is done once the server accepts it, and the list is
    // read again either way.
    private func withdraw(_ r: LeaveRequest) async {
        actionError = nil
        do {
            try await session.api.postNoContent("/api/v1/leave/requests/\(r.id)/withdraw", json: [String: String]())
            await refresh()
        } catch { actionError = APIError.from(error, host: "").message }
    }

    private func cancel(_ r: LeaveRequest) async {
        actionError = nil
        struct Body: Encodable { let reason: String? }
        do {
            try await session.api.postNoContent("/api/v1/leave/requests/\(r.id)/cancel", json: Body(reason: nil))
            await refresh()
        } catch { actionError = APIError.from(error, host: "").message }
    }
}

struct BalanceRow: View {
    let balance: LeaveBalance
    var title: String? = nil

    var body: some View {
        let unit = balance.unit == "hours" ? "h" : "d"
        AdaptiveRow {
            VStack(alignment: .leading, spacing: 2) {
                Text(name).font(CrowFont.body(.body, weight: .medium)).fixedSize(horizontal: false, vertical: true)
                Text("Taken \(Fmt.quantity(balance.taken))\(unit) · Pending \(Fmt.quantity(balance.pending))\(unit)")
                    .font(CrowFont.mono(.caption)).foregroundStyle(Crow.muted).fixedSize(horizontal: false, vertical: true)
            }
        } trailing: {
            if let available = balance.available, balance.tracked {
                Text("\(Fmt.quantity(available))\(unit)").font(CrowFont.mono(.title3, weight: .semibold))
            } else {
                Text("No limit").font(CrowFont.mono(.subheadline)).foregroundStyle(Crow.muted)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibility)
        .accessibilityIdentifier("leave.balance")
    }

    private var name: String { title ?? balance.name }

    private var accessibility: String {
        let u = balance.unit == "hours" ? "hours" : "days"
        let avail = balance.available.map { "\(Fmt.quantity($0)) \(u) available" } ?? "no limit"
        return "\(name), \(avail), \(Fmt.quantity(balance.taken)) taken, \(Fmt.quantity(balance.pending)) pending"
    }
}

struct LeaveRequestRow: View {
    let request: LeaveRequest

    var body: some View {
        let (label, tone) = request.statusLabel
        AdaptiveRow {
            VStack(alignment: .leading, spacing: 2) {
                Text(request.type.name).font(CrowFont.body(.body, weight: .medium)).fixedSize(horizontal: false, vertical: true)
                Text(dates).font(CrowFont.mono(.caption)).foregroundStyle(Crow.muted).fixedSize(horizontal: false, vertical: true)
            }
        } trailing: {
            VStack(alignment: .leading, spacing: 4) {
                StatusChip(text: label, tone: tone)
                Text(LeaveRequestRow.quantity(request.quantity, unit: request.unit))
                    .font(CrowFont.mono(.caption)).foregroundStyle(Crow.muted)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("leave.request")
    }

    static func quantity(_ q: Double, unit: String) -> String {
        "\(Fmt.quantity(q)) \(unit == "hours" ? "h" : q == 1 ? "day" : "days")"
    }

    private var dates: String {
        let s = Fmt.dayString(request.startDate), e = Fmt.dayString(request.endDate)
        return s == e ? s + (request.startSession == "am" ? " (morning)" : request.startSession == "pm" ? " (afternoon)" : "") : "\(s) – \(e)"
    }
}

/// One leave request, read from the server: what, whose, when, how much, the reason, the child
/// and the days counted (the web's request sheet, without its approval chain).
struct LeaveRequestSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(Session.self) private var session
    let id: String
    @State private var state: LoadState<LeaveRequestDetail> = .loading

    var body: some View {
        NavigationStack {
            AsyncContent(state: $state, load: { try await session.api.get("/api/v1/leave/requests/\(id)") }) { r in
                RowsScreen {
                    let row = r.row
                    let (label, tone) = row.statusLabel
                    VStack(alignment: .leading, spacing: 8) {
                        StatusChip(text: label, tone: tone)
                        Text(r.type.name).font(CrowFont.mono(.title3, weight: .semibold)).fixedSize(horizontal: false, vertical: true)
                            .accessibilityAddTraits(.isHeader)
                            .accessibilityIdentifier("leaveRequest.title")
                        Text("\(LeaveRequestSheet.dates(r)) · \(LeaveRequestRow.quantity(r.quantity, unit: r.unit))")
                            .font(CrowFont.mono(.subheadline)).foregroundStyle(Crow.muted).fixedSize(horizontal: false, vertical: true)
                    }
                    .crowRowPadding(vertical: 16)
                    RowGroup {
                        InfoRow("Employee", r.employee.name)
                        if let reason = r.reason, !reason.isEmpty { InfoRow("Reason", reason) }
                        if let child = r.child { InfoRow("Child", child.name) }
                        if let why = r.cancelReason, !why.isEmpty { InfoRow("Why cancel", why) }
                        InfoRow("Attachments", r.attachments.isEmpty ? "None" : r.attachments.map(\.filename).joined(separator: ", "))
                    }
                    if let days = r.days, !days.isEmpty {
                        RowGroup(header: "Days counted") {
                            ForEach(days, id: \.self) { d in
                                let day = Fmt.parseDay(d.date).map(Fmt.dayShort) ?? d.date
                                let half = d.session == "am" ? " (morning)" : d.session == "pm" ? " (afternoon)" : ""
                                InfoRow(day, Fmt.quantity(d.quantity) + half)
                            }
                        }
                    }
                }
            }
            .crowScreen()
            .navigationTitle("Leave request")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() }.keyboardShortcut(.cancelAction) } }
        }
    }

    /// "16 Nov 2026 (morning)", "16 – 18 Nov 2026".
    static func dates(_ r: LeaveRequestDetail) -> String {
        if r.startDate == r.endDate {
            return Fmt.dayString(r.startDate) + (r.startSession == "am" ? " (morning)" : r.startSession == "pm" ? " (afternoon)" : "")
        }
        return Fmt.dateRange(r.startDate, r.endDate)
    }
}

struct ApplyLeaveView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(Session.self) private var session
    @Environment(AppModel.self) private var model
    let onDone: () -> Void

    @State private var types: LoadState<[LeaveType]> = .loading
    @State private var typeID: String = ""
    @State private var start = ApplyLeaveView.nextWorkingDay()
    @State private var end = ApplyLeaveView.nextWorkingDay()
    @State private var halfDay = false
    @State private var halfDaySession = "am"
    @State private var children: LoadState<[LeaveChild]> = .loading
    @State private var childID = ""
    @State private var reason = ""
    @State private var attachment: CapturedImage?
    @State private var quote: LeaveQuote?
    @State private var quoteError: String?
    @State private var submitting = false
    @State private var error: String?
    @State private var showCamera = false
    @State private var pickedPhoto: PhotosPickerItem?
    @State private var choosingPhoto = false
    @FocusState private var reasonFocused: Bool

    private var selectedType: LeaveType? { types.value?.first { $0.id == typeID } }

    /// The first Monday-to-Friday after today (Singapore), a sensible default for a new application.
    static func nextWorkingDay(from now: Date = Date()) -> Date {
        let cal = Fmt.calendar
        var d = cal.date(byAdding: .day, value: 1, to: now)!
        while cal.isDateInWeekend(d) { d = cal.date(byAdding: .day, value: 1, to: d)! }
        return d
    }

    var body: some View {
        // Read in this view's own body (not only inside AsyncContent's closure, where it can be a
        // stale copy), so the form follows the loaded types; as in New claim.
        let selected = selectedType
        let shownQuote = quote
        let childIssue = LeaveForm.issue("childId", in: shownQuote)
        NavigationStack {
            AsyncContent(state: $types, load: loadTypes) { list in
                RowsScreen {
                    VStack(alignment: .leading, spacing: 18) {
                        ChoiceRow(title: "Leave type", options: list.map { (id: $0.id, name: $0.name) }, selection: $typeID, identifier: "leave.type")
                        FormField("From") {
                            DatePicker("From", selection: $start, displayedComponents: .date)
                                .labelsHidden()
                                .singaporeDates()
                                .accessibilityIdentifier("leave.start")
                        }
                        FormField("To") {
                            DatePicker("To", selection: $end, in: start..., displayedComponents: .date)
                                .labelsHidden()
                                .singaporeDates()
                                .accessibilityIdentifier("leave.end")
                        }
                        if selected?.halfDays == true && Fmt.day(start) == Fmt.day(end) {
                            Toggle(isOn: $halfDay) {
                                Text("Half day").font(CrowFont.body()).fixedSize(horizontal: false, vertical: true)
                            }
                            .accessibilityIdentifier("leave.halfDay")
                            if halfDay {
                                SegmentedChoice(title: "Which half", options: [(id: "am", name: "Morning"), (id: "pm", name: "Afternoon")], selection: $halfDaySession)
                            }
                        }
                        if selected?.needsChild == true {
                            childField(issue: childIssue)
                        }
                        FormField("Reason (optional)") {
                            TextField("Reason (optional)", text: $reason, prompt: Text("A note for your approver"), axis: .vertical)
                                .lineLimit(2...5)
                                .font(CrowFont.body())
                                .focused($reasonFocused)
                                .accessibilityIdentifier("leave.reason")
                                .crowFieldBox(focused: reasonFocused)
                        }
                        if let t = selected, t.attachment != "none" {
                            VStack(alignment: .leading, spacing: 8) {
                                SectionLabel((t.attachmentLabel ?? "Supporting document") + (t.attachment == "required" ? " (required)" : " (optional)"))
                                    .fixedSize(horizontal: false, vertical: true)
                                if let attachment {
                                    HStack(spacing: 12) {
                                        Image(uiImage: attachment.image).resizable().scaledToFit().frame(height: 60).accessibilityLabel("Attached photo")
                                        Spacer()
                                        Button("Remove", role: .destructive) { self.attachment = nil }
                                            .buttonStyle(.crowCompactDanger)
                                    }
                                } else {
                                    Button { showCamera = true } label: { Label("Take a photo", systemImage: "camera") }
                                        .buttonStyle(.crowSecondary)
                                    Button { choosingPhoto = true } label: { Label("Choose a photo", systemImage: "photo") }
                                        .buttonStyle(.crowSecondary)
                                }
                            }
                        }
                        VStack(alignment: .leading, spacing: 6) {
                            SectionLabel("Days counted")
                            if let shownQuote {
                                QuoteSummary(quote: shownQuote, hiding: LeaveForm.fieldsWithIssues(type: selected))
                            } else if let quoteError {
                                Text(quoteError).font(CrowFont.body(.footnote)).foregroundStyle(Crow.danger)
                                    .fixedSize(horizontal: false, vertical: true)
                            } else {
                                ProgressView()
                            }
                        }
                        if let error {
                            Notice(text: error, tone: .danger, systemImage: "exclamationmark.triangle")
                                .accessibilityIdentifier("leave.error")
                        }
                    }
                    .padding(16)
                }
            }
            // The background only: `RowsScreen` sets the readable column (see New claim).
            .background(Crow.background.ignoresSafeArea())
            // Short like "New claim": at the largest text sizes the inline title has room for
            // about 12 characters of Azeret Mono, and "Apply for leave" was cut off.
            .navigationTitle("New leave")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Apply") { Task { await submit() } }
                        .disabled(!canSubmit)
                        .accessibilityIdentifier("leave.submit")
                }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") { reasonFocused = false }
                }
            }
            .task(id: quoteKey) { await requote() }
            // The employee's children, once a type that needs one is chosen.
            .task(id: selected?.needsChild == true) { if selected?.needsChild == true { await loadChildren() } }
            // Moving From past To moves To along, so the form never shows an end before the start
            // (the request already used the later of the two).
            .onChange(of: start) { _, newStart in if end < newStart { end = newStart } }
            .sheet(isPresented: $showCamera) {
                CameraCapture(stub: model.env.cameraStub) { attachment = $0; showCamera = false }
            }
            .photosPicker(isPresented: $choosingPhoto, selection: $pickedPhoto, matching: .images)
            .onChange(of: pickedPhoto) { _, item in
                guard let item else { return }
                Task {
                    if let data = try? await item.loadTransferable(type: Data.self), let image = await CapturedImage.make(data: data) {
                        attachment = image
                    }
                }
            }
        }
    }

    /// The child, as on the web: a choice of the employee's children, the server's message for it
    /// (from the quote) under the field, or how to add one when none is recorded.
    @ViewBuilder private func childField(issue: String?) -> some View {
        switch children {
        case .loading:
            FormField("Child") { ProgressView() }
        case .failed(let e):
            FormField("Child") {
                Text(e.message).font(CrowFont.body(.footnote)).foregroundStyle(Crow.danger).fixedSize(horizontal: false, vertical: true)
            }
        case .loaded(let kids) where kids.isEmpty:
            FormField("Child") {
                Text(LeaveForm.noChildrenHint).font(CrowFont.body(.footnote)).foregroundStyle(Crow.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("leave.noChildren")
            }
        case .loaded(let kids):
            VStack(alignment: .leading, spacing: 6) {
                ChoiceRow(title: "Child", options: kids.map { (id: $0.id, name: $0.name) }, selection: $childID,
                          identifier: "leave.child", placeholder: LeaveForm.childPlaceholder)
                if let issue {
                    Text(issue).font(CrowFont.body(.footnote)).foregroundStyle(Crow.danger)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("leave.childIssue")
                }
            }
        }
    }

    private var canSubmit: Bool {
        guard !submitting, selectedType != nil, quote?.ok == true else { return false }
        if selectedType?.attachment == "required" && attachment == nil { return false }
        return true
    }

    private var sessions: (String, String) {
        if halfDay && Fmt.day(start) == Fmt.day(end) { return (halfDaySession, halfDaySession) }
        return ("full", "full")
    }

    private var quoteKey: String { "\(typeID)|\(Fmt.day(start))|\(Fmt.day(end))|\(sessions.0)|\(LeaveForm.childID(type: selectedType, chosen: childID) ?? "")" }

    private func loadTypes() async throws -> [LeaveType] {
        let list: LeaveTypeList = try await session.api.get("/api/v1/leave/types")
        let usable = list.items.filter { !$0.archived }
        if typeID.isEmpty { typeID = (usable.first { $0.code == "annual" } ?? usable.first)?.id ?? "" }
        return usable
    }

    private func loadChildren() async {
        do {
            let list: LeaveChildList = try await session.api.get("/api/v1/leave/children")
            children = .loaded(list.items)
            // A chosen child that isn't on the record any more is cleared.
            if !childID.isEmpty && !list.items.contains(where: { $0.id == childID }) { childID = "" }
        } catch {
            children.fail(error)
        }
    }

    private var application: LeaveApplication? {
        guard let t = selectedType else { return nil }
        return LeaveForm.application(type: t, start: start, end: end, sessions: sessions, childChoice: childID)
    }

    private func requote() async {
        guard let application else { return }
        try? await Task.sleep(for: .milliseconds(250))
        guard !Task.isCancelled else { return }
        quote = nil
        quoteError = nil
        do {
            let next: LeaveQuote = try await session.api.post("/api/v1/leave/quote", json: application)
            if !Task.isCancelled { quote = next }
        } catch {
            // Cancelled because the dates changed again: not an error ("You're offline" flashed
            // under Days counted while the next quote loaded).
            if !Task.isCancelled { quoteError = APIError.from(error, host: "").message }
        }
    }

    private func submit() async {
        guard var app = application else { return }
        submitting = true
        defer { submitting = false }
        error = nil
        let trimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        app.reason = trimmed.isEmpty ? nil : trimmed
        if let attachment, let jpeg = attachment.jpeg {
            app.attachments = [.init(filename: "document.jpg", contentType: "image/jpeg", dataBase64: jpeg.base64EncodedString())]
        }
        do {
            // Not decoded: once the server accepted it the leave exists, and an error here would
            // invite applying twice.
            try await session.api.postNoContent("/api/v1/leave/requests", json: app)
            onDone()
            dismiss()
        } catch {
            self.error = APIError.from(error, host: "").message
        }
    }
}

struct QuoteSummary: View {
    let quote: LeaveQuote
    /// Fields whose issues the form shows at the field itself (the child).
    var hiding: Set<String> = []

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            let unit = quote.unit == "hours" ? "hours" : (quote.quantity == 1 ? "day" : "days")
            Text("\(Fmt.quantity(quote.quantity)) \(unit)")
                .font(CrowFont.mono(.title3, weight: .semibold))
                .accessibilityIdentifier("leave.quote")
            ForEach(quote.years, id: \.year) { y in
                if y.tracked, let after = y.after {
                    Text("\(String(y.year)) balance after: \(Fmt.quantity(after))").font(CrowFont.mono(.footnote)).foregroundStyle(Crow.muted)
                }
            }
            ForEach(LeaveForm.otherIssues(quote, shownAt: hiding), id: \.message) { i in
                Text(i.message).font(CrowFont.body(.footnote)).foregroundStyle(Crow.danger).fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("leave.quoteIssue")
            }
            ForEach(quote.warnings, id: \.self) { w in
                Text(w).font(CrowFont.body(.footnote)).foregroundStyle(Crow.warning).fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}
