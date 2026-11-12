import SwiftUI

/// My schedule, as on the web: offers from colleagues waiting for an answer, the next 14 days
/// (each upcoming shift can be swapped or given away), the open shifts to pick up, and my own
/// requests with their status. A colleague accepts a swap first, then the manager approves; a
/// pickup goes straight to the manager. Nothing changes on the roster until it is approved.
struct ScheduleView: View {
    @Environment(AppModel.self) private var model
    @Environment(Session.self) private var session
    @State private var state: LoadState<ScheduleMe> = .loading
    @State private var offering: ScheduleMe.Shift?
    @State private var busy: String?
    @State private var notice: (text: String, tone: Tone)?

    var body: some View {
        AsyncContent(state: $state, load: load) { s in
            RowsScreen {
                if let notice {
                    Notice(text: notice.text, tone: notice.tone, systemImage: notice.tone == .success ? "checkmark.circle" : "exclamationmark.triangle")
                        .padding(.horizontal, 16)
                        .padding(.top, 16)
                        .accessibilityIdentifier("schedule.notice")
                }
                if s.employeeId == nil && s.shifts.isEmpty && s.openShifts.isEmpty && s.weeks.isEmpty {
                    EmptyStateView(title: "No employee record", message: "Your sign-in isn't linked to an employee record, so there's no schedule to show. Ask HR to link it.", systemImage: "person.crop.circle.badge.questionmark")
                        .padding(.top, 24)
                } else {
                    offers(SwapRules.incomingOffers(s.swaps))
                    days(s)
                    openShifts(s.openShifts)
                    requests(SwapRules.myRequests(s.swaps))
                }
            }
            .refreshable { await reload() }
        }
        .crowScreen()
        .navigationTitle("My schedule")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $offering) { shift in
            SwapOfferSheet(shift: shift, me: session.me?.employeeId) { message in
                notice = (message, .success)
                Task { await reload() }
            }
        }
        .onChange(of: model.pendingTarget, initial: true) { _, target in
            if target == .schedule { model.pendingTarget = nil }
        }
    }

    // MARK: Sections

    @ViewBuilder private func offers(_ offers: [ShiftSwap]) -> some View {
        if !offers.isEmpty {
            RowGroup(header: "Waiting for your answer") {
                ForEach(offers) { o in
                    VStack(alignment: .leading, spacing: 10) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(SwapRules.offerText(o)).font(CrowFont.body()).fixedSize(horizontal: false, vertical: true)
                            if let note = o.note, !note.isEmpty {
                                Text("“\(note)”").font(CrowFont.body(.footnote)).foregroundStyle(Crow.muted).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .accessibilityElement(children: .combine)
                        HStack(spacing: 10) {
                            Button("Decline") { Task { await act(o, "decline") } }
                                .buttonStyle(.crowCompact)
                                .disabled(busy != nil)
                                .accessibilityIdentifier("schedule.decline")
                            Button("Accept") { Task { await act(o, "accept") } }
                                .buttonStyle(.crowCompact)
                                .disabled(busy != nil)
                                .accessibilityIdentifier("schedule.accept")
                        }
                    }
                    .crowRowPadding()
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier("schedule.offer")
                }
            }
        }
    }

    private func days(_ s: ScheduleMe) -> some View {
        let today = Fmt.today()
        return RowGroup(header: "Next 14 days") {
            ForEach(SwapRules.weeks(s)) { week in
                if !week.published {
                    Text(SwapRules.unpublishedNotice(weekStart: week.weekStart, today: today))
                        .font(CrowFont.body(.subheadline)).foregroundStyle(Crow.muted)
                        .fixedSize(horizontal: false, vertical: true)
                        .crowRowPadding()
                        .accessibilityIdentifier("schedule.unpublished")
                } else {
                    ForEach(week.days, id: \.self) { day in
                        DayRow(day: day, today: today, shifts: s.shifts.filter { $0.date == day }, busy: busy != nil) { offering = $0 }
                    }
                }
            }
        }
    }

    private func openShifts(_ shifts: [ScheduleMe.Shift]) -> some View {
        RowGroup(header: "Open shifts") {
            if shifts.isEmpty {
                Text("No open shifts in the next 14 days.").font(CrowFont.body(.subheadline)).foregroundStyle(Crow.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .crowRowPadding()
            }
            ForEach(shifts) { shift in
                VStack(alignment: .leading, spacing: 10) {
                    ShiftLine(shift: shift, showDay: true)
                    Button("Pick up") { Task { await pickUp(shift) } }
                        .buttonStyle(.crowCompact)
                        .disabled(busy != nil)
                        .accessibilityHint("Asks your manager to give you this shift")
                        .accessibilityIdentifier("schedule.pickUp")
                }
                .crowRowPadding()
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("schedule.openShift")
            }
        }
    }

    private func requests(_ swaps: [ShiftSwap]) -> some View {
        RowGroup(header: "My swap requests") {
            if swaps.isEmpty {
                Text("You haven't asked for any swaps.").font(CrowFont.body(.subheadline)).foregroundStyle(Crow.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .crowRowPadding()
            }
            ForEach(swaps) { s in
                let (label, tone) = SwapRules.status(s.status)
                VStack(alignment: .leading, spacing: 8) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(SwapRules.requestText(s)).font(CrowFont.body()).fixedSize(horizontal: false, vertical: true)
                        StatusChip(text: label, tone: tone)
                        if let reason = s.reason, !reason.isEmpty, s.status != "approved" {
                            Text(reason).font(CrowFont.body(.footnote)).foregroundStyle(Crow.muted).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .accessibilityElement(children: .combine)
                    if SwapRules.canCancel(s) {
                        Button("Cancel request") { Task { await act(s, "cancel") } }
                            .buttonStyle(.crowCompact)
                            .disabled(busy != nil)
                            .accessibilityIdentifier("schedule.cancelRequest")
                    }
                }
                .crowRowPadding()
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("schedule.request")
            }
        }
    }

    // MARK: Actions

    private func load() async throws -> ScheduleMe { try await session.api.get("/api/v1/scheduling/me") }

    private func reload() async {
        do { state = .loaded(try await load()) } catch { state.fail(error) }
    }

    /// Accept or decline a colleague's offer, or cancel my own request.
    private func act(_ s: ShiftSwap, _ action: String) async {
        busy = action
        defer { busy = nil }
        do {
            let _: ShiftSwap = try await session.api.post("/api/v1/scheduling/swaps/\(s.id)/\(action)")
            notice = (SwapRules.doneMessage(action), .success)
        } catch {
            notice = (APIError.from(error, host: "").message, .danger)
        }
        await reload()
    }

    private func pickUp(_ shift: ScheduleMe.Shift) async {
        busy = "pickup"
        defer { busy = nil }
        do {
            let _: ShiftSwap = try await session.api.post("/api/v1/scheduling/swaps", json: NewSwap(kind: SwapRules.Kind.pickup.rawValue, shiftId: shift.id))
            notice = (SwapRules.doneMessage("pickup"), .success)
        } catch {
            notice = (APIError.from(error, host: "").message, .danger)
        }
        await reload()
    }
}

/// One day of the next 14: its shifts (each upcoming one with Swap, or "Swap asked" while a
/// request is open), a rest day, or "Off".
private struct DayRow: View {
    let day: String
    let today: String
    let shifts: [ScheduleMe.Shift]
    let busy: Bool
    let onOffer: (ScheduleMe.Shift) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(Fmt.parseDay(day).map(Fmt.dayShort) ?? day).font(CrowFont.mono(.subheadline, weight: .semibold))
                .accessibilityAddTraits(.isHeader)
            if shifts.isEmpty {
                // Not "Off": Xcode's audit reports a word ending in Ubuntu's "ff" ligature as clipped.
                Text("No shift").font(CrowFont.body(.subheadline)).foregroundStyle(Crow.muted)
            }
            ForEach(shifts) { shift in
                VStack(alignment: .leading, spacing: 8) {
                    ShiftLine(shift: shift, showDay: false)
                    if shift.kind == "shift" && shift.date >= today {
                        if shift.pendingSwap == true {
                            StatusChip(text: "Swap asked", tone: .warning)
                        } else if SwapRules.canOffer(shift, today: today) {
                            Button { onOffer(shift) } label: { Label("Swap", systemImage: "arrow.left.arrow.right") }
                                .buttonStyle(.crowCompact)
                                .disabled(busy)
                                .accessibilityLabel("Swap or give away \(Fmt.parseDay(day).map(Fmt.daySpoken) ?? day)")
                                .accessibilityIdentifier("schedule.swap")
                        }
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("schedule.shift")
            }
        }
        .crowRowPadding()
        .background(day == today ? Crow.kuningSoft : Color.clear)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("schedule.day")
    }
}

/// A shift's time (with its template code), place, paid time and break, and note; or a rest day.
private struct ShiftLine: View {
    let shift: ScheduleMe.Shift
    let showDay: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            if showDay {
                Text(Fmt.parseDay(shift.date).map(Fmt.dayShort) ?? shift.date).font(CrowFont.mono(.subheadline, weight: .semibold))
            }
            if shift.kind == "rest" {
                StatusChip(text: "Rest day", tone: .neutral)
            } else {
                Text(SwapRules.time(shift) + (shift.templateCode.map { "  \($0)" } ?? "")).font(CrowFont.mono(.body, weight: .semibold))
                    .fixedSize(horizontal: false, vertical: true)
                Text(SwapRules.details(shift)).font(CrowFont.body(.footnote)).foregroundStyle(Crow.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let note = shift.note, !note.isEmpty {
                Text("“\(note)”").font(CrowFont.body(.footnote)).foregroundStyle(Crow.muted).fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// Offer one of my shifts to a colleague: swap it for one of theirs on the same roster, or give it
/// away. The colleague accepts first, then the manager approves.
struct SwapOfferSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(Session.self) private var session
    let shift: ScheduleMe.Shift
    let me: String?
    let onSent: (String) -> Void
    @State private var roster: LoadState<RosterWeek> = .loading
    @State private var kind: SwapRules.Kind = .swap
    @State private var peer = ""
    @State private var peerShift = ""
    @State private var note = ""
    @State private var sending = false
    @State private var error: String?
    @FocusState private var noteFocused: Bool

    var body: some View {
        let today = Fmt.today()
        let request = SwapRules.request(kind: kind, shiftID: shift.id, peer: peer, peerShift: peerShift, note: note)
        NavigationStack {
            AsyncContent(state: $roster, load: load) { r in
                RowsScreen {
                    VStack(alignment: .leading, spacing: 18) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("\(Fmt.parseDay(shift.date).map(Fmt.dayShort) ?? shift.date), \(SwapRules.time(shift))")
                                .font(CrowFont.mono(.title3, weight: .semibold)).fixedSize(horizontal: false, vertical: true)
                                .accessibilityAddTraits(.isHeader)
                            Text("Your colleague accepts first, then your manager approves. Nothing changes until then.")
                                .font(CrowFont.body(.subheadline)).foregroundStyle(Crow.muted).fixedSize(horizontal: false, vertical: true)
                        }
                        SegmentedChoice(title: "Type of request", options: [(id: SwapRules.Kind.swap, name: "Swap for one of their shifts"), (id: .giveaway, name: "Give it away")], selection: $kind)
                            .accessibilityIdentifier("swap.kind")
                        let colleagues = SwapRules.colleagues(r, me: me)
                        if colleagues.isEmpty {
                            FormField("Colleague") {
                                Text("Nobody else is on this roster.").font(CrowFont.body(.footnote)).foregroundStyle(Crow.muted)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        } else {
                            ChoiceRow(title: "Colleague", options: colleagues.map { (id: $0.id, name: $0.name) },
                                      selection: Binding(get: { peer }, set: { peer = $0; peerShift = "" }),
                                      identifier: "swap.colleague", placeholder: "Choose a colleague")
                        }
                        if kind == .swap && !peer.isEmpty {
                            let theirs = SwapRules.theirShifts(r, peer: peer, today: today)
                            if theirs.isEmpty {
                                FormField("Their shift you'd take") {
                                    Text("They have no upcoming shifts on this roster. Give the shift away instead.")
                                        .font(CrowFont.body(.footnote)).foregroundStyle(Crow.muted)
                                        .fixedSize(horizontal: false, vertical: true)
                                        .accessibilityIdentifier("swap.noShifts")
                                }
                            } else {
                                ChoiceRow(title: "Their shift you'd take",
                                          options: theirs.map { (id: $0.id, name: "\(Fmt.parseDay($0.date).map(Fmt.dayShort) ?? $0.date) \($0.start ?? "")–\($0.end ?? "")") },
                                          selection: $peerShift, identifier: "swap.theirShift", placeholder: "Choose a shift")
                            }
                        }
                        FormField("Note (optional)") {
                            TextField("Note (optional)", text: $note, prompt: Text("A word for your colleague"), axis: .vertical)
                                .lineLimit(2...4)
                                .font(CrowFont.body())
                                .focused($noteFocused)
                                .crowFieldBox(focused: noteFocused, invalid: note.count > 200)
                                .accessibilityIdentifier("swap.note")
                            Text("Up to 200 characters.").font(CrowFont.body(.footnote)).foregroundStyle(note.count > 200 ? Crow.danger : Crow.muted)
                        }
                        if let error {
                            Notice(text: error, tone: .danger, systemImage: "exclamationmark.triangle")
                                .accessibilityIdentifier("swap.error")
                        }
                        Button { Task { await send(request) } } label: { Text(sending ? "Sending…" : "Send request") }
                            .buttonStyle(.crowPrimary)
                            .disabled(request == nil || note.count > 200 || sending)
                            .accessibilityIdentifier("swap.send")
                    }
                    .padding(16)
                }
            }
            // The background only: `RowsScreen` sets the readable column (see New claim).
            .background(Crow.background.ignoresSafeArea())
            // Short: "Swap" is what the button that opens it says.
            .navigationTitle("Swap")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction) }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") { noteFocused = false }
                }
            }
        }
    }

    private func load() async throws -> RosterWeek {
        guard let id = shift.rosterId else { throw APIError.unreadable }
        return try await session.api.get("/api/v1/scheduling/rosters/\(id)")
    }

    private func send(_ request: NewSwap?) async {
        guard let request else { return }
        sending = true
        defer { sending = false }
        error = nil
        do {
            let _: ShiftSwap = try await session.api.post("/api/v1/scheduling/swaps", json: request)
            onSent(SwapRules.doneMessage("send"))
            dismiss()
        } catch {
            self.error = APIError.from(error, host: "").message
        }
    }
}

/// A shift on Today's "Next shifts": the day, place and note, and its time or "Rest day".
struct ShiftRow: View {
    let shift: ScheduleMe.Shift

    /// "Friday 13 November, Kopi bar, 09:00 to 18:00": the day in full, "to" rather than a dash.
    var spoken: String {
        let day = Fmt.parseDay(shift.date).map(Fmt.daySpoken) ?? shift.date
        let when = shift.kind == "rest" ? "Rest day" : "\(shift.start ?? "") to \(shift.end ?? "")"
        return [day, shift.scopeLabel, shift.note, when].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
    }

    var body: some View {
        AdaptiveRow {
            VStack(alignment: .leading, spacing: 2) {
                Text(Fmt.parseDay(shift.date).map(Fmt.dayShort) ?? shift.date).font(CrowFont.mono(.body, weight: .semibold))
                Text(shift.scopeLabel).font(CrowFont.body(.footnote)).foregroundStyle(Crow.muted)
                if let note = shift.note { Text(note).font(CrowFont.body(.footnote)).foregroundStyle(Crow.muted) }
            }
        } trailing: {
            if shift.kind == "rest" {
                StatusChip(text: "Rest day", tone: .neutral)
            } else {
                Text("\(shift.start ?? "") – \(shift.end ?? "")").font(CrowFont.mono(.body))
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(spoken)
        .accessibilityIdentifier("shift.row")
    }
}
