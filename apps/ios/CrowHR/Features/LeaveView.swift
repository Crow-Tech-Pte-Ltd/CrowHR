import PhotosUI
import SwiftUI

struct LeaveData: Sendable {
    let balances: [LeaveBalance]
    let requests: [LeaveRequest]
}

/// Balances, own history, apply, withdraw and cancel.
struct LeaveView: View {
    @Environment(Session.self) private var session
    @State private var state: LoadState<LeaveData> = .loading
    @State private var applying = false
    @State private var actionError: String?
    @State private var cancelling: LeaveRequest?

    var body: some View {
        AsyncContent(state: $state, load: load) { data in
            List {
                if let actionError {
                    Notice(text: actionError, tone: .danger, systemImage: "exclamationmark.triangle").listRowSeparator(.hidden)
                }
                Section {
                    let shown = data.balances.filter { $0.eligible }
                    if shown.isEmpty {
                        EmptyStateView(title: "No leave balances", message: "Your company hasn't set up leave for you yet. Ask HR.", systemImage: "calendar")
                    }
                    ForEach(shown) { b in BalanceRow(balance: b) }
                } header: { SectionLabel("Balances \(Calendar.current.component(.year, from: Date()))") }
                Section {
                    if data.requests.isEmpty {
                        EmptyStateView(title: "No leave yet", message: "Leave you apply for appears here with its status.", systemImage: "calendar.badge.plus")
                    }
                    ForEach(data.requests) { r in
                        LeaveRequestRow(request: r)
                            .swipeActions {
                                if r.status == "pending" {
                                    Button("Withdraw", role: .destructive) { Task { await withdraw(r) } }
                                } else if r.status == "approved" {
                                    Button("Cancel leave") { cancelling = r }.tint(Crow.warning)
                                }
                            }
                            .contextMenu {
                                if r.status == "pending" { Button("Withdraw", role: .destructive) { Task { await withdraw(r) } } }
                                if r.status == "approved" { Button("Cancel leave") { cancelling = r } }
                            }
                    }
                } header: { SectionLabel("My leave") }
            }
            .listStyle(.plain)
            .refreshable { await refresh() }
        }
        .crowScreen()
        .navigationTitle("Leave")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { applying = true } label: { Label("Apply for leave", systemImage: "plus") }
                    .accessibilityIdentifier("leave.apply")
            }
        }
        .sheet(isPresented: $applying) {
            ApplyLeaveView { Task { await refresh() } }
        }
        .alert("Cancel this leave?", isPresented: Binding(get: { cancelling != nil }, set: { if !$0 { cancelling = nil } }), presenting: cancelling) { r in
            Button("Cancel leave", role: .destructive) { Task { await cancel(r) } }
            Button("Keep it", role: .cancel) {}
        } message: { r in
            Text("\(r.type.name), \(Fmt.dayString(r.startDate)). Your approver is asked to confirm.")
        }
    }

    private func load() async throws -> LeaveData {
        let api = session.api
        async let balances: LeaveBalanceList = api.get("/api/v1/leave/balances")
        var q: [URLQueryItem] = [URLQueryItem(name: "limit", value: "50")]
        if let e = session.me?.employeeId { q.append(URLQueryItem(name: "employeeId", value: e)) }
        let query = q
        async let requests: LeaveRequestList = api.get("/api/v1/leave/requests", query: query)
        return try await LeaveData(balances: balances.items, requests: requests.items)
    }

    private func refresh() async {
        do { state = .loaded(try await load()) } catch { state = .failed(APIError.from(error, host: "")) }
    }

    private func withdraw(_ r: LeaveRequest) async {
        actionError = nil
        do {
            let _: LeaveRequest = try await session.api.post("/api/v1/leave/requests/\(r.id)/withdraw", json: [String: String]())
            await refresh()
        } catch { actionError = APIError.from(error, host: "").message }
    }

    private func cancel(_ r: LeaveRequest) async {
        actionError = nil
        struct Body: Encodable { let reason: String? }
        do {
            let _: LeaveRequest = try await session.api.post("/api/v1/leave/requests/\(r.id)/cancel", json: Body(reason: nil))
            await refresh()
        } catch { actionError = APIError.from(error, host: "").message }
    }
}

struct BalanceRow: View {
    let balance: LeaveBalance

    var body: some View {
        let unit = balance.unit == "hours" ? "h" : "d"
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(balance.name).font(CrowFont.body(.body, weight: .medium))
                Text("Taken \(Fmt.quantity(balance.taken))\(unit) · Pending \(Fmt.quantity(balance.pending))\(unit)")
                    .font(CrowFont.mono(.caption)).foregroundStyle(Crow.muted)
            }
            Spacer()
            if let available = balance.available, balance.tracked {
                Text("\(Fmt.quantity(available))\(unit)").font(CrowFont.mono(.title3, weight: .semibold))
            } else {
                Text("No limit").font(CrowFont.mono(.subheadline)).foregroundStyle(Crow.muted)
            }
        }
        .padding(.vertical, 4)
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
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(request.type.name).font(CrowFont.body(.body, weight: .medium))
                Text(dates).font(CrowFont.mono(.caption)).foregroundStyle(Crow.muted)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                StatusChip(text: label, tone: tone)
                Text("\(Fmt.quantity(request.quantity)) \(request.unit == "hours" ? "h" : request.quantity == 1 ? "day" : "days")")
                    .font(CrowFont.mono(.caption)).foregroundStyle(Crow.muted)
            }
        }
        .padding(.vertical, 4)
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
    @State private var start = Date()
    @State private var end = Date()
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

    private var selectedType: LeaveType? { types.value?.first { $0.id == typeID } }

    var body: some View {
        NavigationStack {
            AsyncContent(state: $types, load: loadTypes) { list in
                Form {
                    Section {
                        Picker("Leave type", selection: $typeID) {
                            ForEach(list) { Text($0.name).tag($0.id) }
                        }
                        .accessibilityIdentifier("leave.type")
                        DatePicker("From", selection: $start, displayedComponents: .date)
                            .accessibilityIdentifier("leave.start")
                        DatePicker("To", selection: $end, in: start..., displayedComponents: .date)
                            .accessibilityIdentifier("leave.end")
                        if selectedType?.halfDays == true && Fmt.day(start) == Fmt.day(end) {
                            Toggle("Half day", isOn: $halfDay)
                            if halfDay {
                                Picker("Which half", selection: $halfDaySession) {
                                    Text("Morning").tag("am")
                                    Text("Afternoon").tag("pm")
                                }
                                .pickerStyle(.segmented)
                            }
                        }
                    }
                    Section {
                        TextField("Reason (optional)", text: $reason, axis: .vertical)
                            .lineLimit(2...5)
                            .accessibilityIdentifier("leave.reason")
                    }
                    if let t = selectedType, t.attachment != "none" {
                        Section {
                            if let attachment {
                                HStack {
                                    Image(uiImage: attachment.image).resizable().scaledToFit().frame(height: 60).accessibilityLabel("Attached photo")
                                    Spacer()
                                    Button("Remove", role: .destructive) { self.attachment = nil }
                                }
                            } else {
                                Button { showCamera = true } label: { Label("Take a photo", systemImage: "camera") }
                                PhotosPicker(selection: $pickedPhoto, matching: .images) { Label("Choose a photo", systemImage: "photo") }
                            }
                        } header: {
                            Text((t.attachmentLabel ?? "Supporting document") + (t.attachment == "required" ? " (required)" : " (optional)"))
                        }
                    }
                    Section {
                        if let quote {
                            QuoteSummary(quote: quote)
                        } else if let quoteError {
                            Text(quoteError).font(CrowFont.body(.footnote)).foregroundStyle(Crow.danger)
                        } else {
                            ProgressView()
                        }
                    } header: { Text("Days counted") }
                    if let error {
                        Section { Text(error).foregroundStyle(Crow.danger).accessibilityIdentifier("leave.error") }
                    }
                }
                .scrollContentBackground(.hidden)
            }
            .crowScreen()
            .navigationTitle("Apply for leave")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Apply") { Task { await submit() } }
                        .disabled(!canSubmit)
                        .accessibilityIdentifier("leave.submit")
                }
            }
            .task(id: quoteKey) { await requote() }
            .sheet(isPresented: $showCamera) {
                CameraCapture(stub: model.env.cameraStub) { attachment = $0; showCamera = false }
            }
            .onChange(of: pickedPhoto) { _, item in
                guard let item else { return }
                Task {
                    if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) {
                        attachment = CapturedImage(image: image)
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
            quote = try await session.api.post("/api/v1/leave/quote", json: application)
        } catch {
            quoteError = APIError.from(error, host: "").message
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
            let _: LeaveRequest = try await session.api.post("/api/v1/leave/requests", json: app)
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
