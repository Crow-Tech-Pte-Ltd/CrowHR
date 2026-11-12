import PhotosUI
import SwiftUI

struct LeaveData: Sendable {
    let balances: [LeaveBalance]
    let requests: [LeaveRequest]
    /// The sign-in has an employee record (an owner or admin may not): without one there is no
    /// leave of their own.
    var linked = true

    /// "My leave": this person's own requests, newest 50. The list endpoint returns everything
    /// the caller may see (a manager's team, all staff for HR) unless it names the employee, so
    /// there is no query without one.
    static func myRequestsQuery(employeeId: String?) -> [URLQueryItem]? {
        guard let employeeId else { return nil }
        return [URLQueryItem(name: "limit", value: "50"), URLQueryItem(name: "employeeId", value: employeeId)]
    }
}

/// Balances, own history, apply, withdraw and cancel.
struct LeaveView: View {
    @Environment(AppModel.self) private var model
    @Environment(Session.self) private var session
    @State private var state: LoadState<LeaveData> = .loading
    @State private var applying = false
    @State private var actionError: String?
    @State private var cancelling: LeaveRequest?
    @State private var withdrawing: LeaveRequest?

    var body: some View {
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
                    let shown = data.balances.filter { $0.eligible }
                    // The server's year: Singapore's, on the Gregorian calendar.
                    RowGroup(header: "Balances \(Fmt.year(Date()))") {
                        if shown.isEmpty {
                            EmptyStateView(title: "No leave balances", message: "Your company hasn't set up leave for you yet. Ask HR.", systemImage: "calendar")
                        }
                        ForEach(shown) { b in BalanceRow(balance: b).crowRowPadding() }
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
        return try await LeaveData(balances: balances.items, requests: requests.items)
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

    var body: some View {
        let unit = balance.unit == "hours" ? "h" : "d"
        AdaptiveRow {
            VStack(alignment: .leading, spacing: 2) {
                Text(balance.name).font(CrowFont.body(.body, weight: .medium)).fixedSize(horizontal: false, vertical: true)
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

    private var accessibility: String {
        let u = balance.unit == "hours" ? "hours" : "days"
        let avail = balance.available.map { "\(Fmt.quantity($0)) \(u) available" } ?? "no limit"
        return "\(balance.name), \(avail), \(Fmt.quantity(balance.taken)) taken, \(Fmt.quantity(balance.pending)) pending"
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
                Text("\(Fmt.quantity(request.quantity)) \(request.unit == "hours" ? "h" : request.quantity == 1 ? "day" : "days")")
                    .font(CrowFont.mono(.caption)).foregroundStyle(Crow.muted)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("leave.request")
    }

    private var dates: String {
        let s = Fmt.dayString(request.startDate), e = Fmt.dayString(request.endDate)
        return s == e ? s + (request.startSession == "am" ? " (morning)" : request.startSession == "pm" ? " (afternoon)" : "") : "\(s) – \(e)"
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
                            if let quote {
                                QuoteSummary(quote: quote)
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
            .crowScreen()
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

    private var canSubmit: Bool {
        guard !submitting, selectedType != nil, quote?.ok == true else { return false }
        if selectedType?.attachment == "required" && attachment == nil { return false }
        return true
    }

    private var sessions: (String, String) {
        if halfDay && Fmt.day(start) == Fmt.day(end) { return (halfDaySession, halfDaySession) }
        return ("full", "full")
    }

    private var quoteKey: String { "\(typeID)|\(Fmt.day(start))|\(Fmt.day(end))|\(sessions.0)" }

    private func loadTypes() async throws -> [LeaveType] {
        let list: LeaveTypeList = try await session.api.get("/api/v1/leave/types")
        // NOT IMPLEMENTED (app): leave types that need a child are applied for on the web.
        let usable = list.items.filter { !$0.archived && !$0.needsChild }
        if typeID.isEmpty { typeID = usable.first?.id ?? "" }
        return usable
    }

    private var application: LeaveApplication {
        LeaveApplication(leaveTypeId: typeID, startDate: Fmt.day(start), endDate: Fmt.day(max(start, end)), startSession: sessions.0, endSession: sessions.1)
    }

    private func requote() async {
        guard !typeID.isEmpty else { return }
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
        submitting = true
        defer { submitting = false }
        error = nil
        var app = application
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
            ForEach(quote.issues, id: \.message) { i in
                Text(i.message).font(CrowFont.body(.footnote)).foregroundStyle(Crow.danger).fixedSize(horizontal: false, vertical: true)
            }
            ForEach(quote.warnings, id: \.self) { w in
                Text(w).font(CrowFont.body(.footnote)).foregroundStyle(Crow.warning).fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}
