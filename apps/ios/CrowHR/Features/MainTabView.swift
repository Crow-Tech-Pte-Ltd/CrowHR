import SwiftUI

struct MainTabView: View {
    @Environment(AppModel.self) private var model
    @Environment(Session.self) private var session

    var body: some View {
        @Bindable var model = model
        TabView(selection: $model.selectedTab) {
            Tab("Today", systemImage: "clock", value: MainTab.today) {
                NavigationStack { TodayView() }
            }
            .accessibilityIdentifier("tab.today")
            if session.isAvailable(.leave) {
                Tab("Leave", systemImage: "calendar", value: MainTab.leave) {
                    NavigationStack { LeaveView() }
                }
                .accessibilityIdentifier("tab.leave")
            }
            if session.isAvailable(.payslips) {
                Tab("Pay", systemImage: "doc.text", value: MainTab.pay) {
                    NavigationStack { PayslipsView() }
                }
                .accessibilityIdentifier("tab.pay")
            }
            Tab("Inbox", systemImage: "tray", value: MainTab.inbox) {
                NavigationStack { InboxView() }
            }
            .accessibilityIdentifier("tab.inbox")
            Tab("More", systemImage: "ellipsis", value: MainTab.more) {
                NavigationStack { MoreView() }
            }
            .accessibilityIdentifier("tab.more")
        }
        .tint(Crow.ink)
    }
}

/// Clock in/out with the offline queue, plus today's shifts.
struct TodayView: View {
    @Environment(AppModel.self) private var model
    @Environment(Session.self) private var session
    @State private var state: LoadState<AttendanceMe> = .loading
    @State private var busy = false
    @State private var message: (String, Tone)?
    @State private var location = LocationProvider()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text(greeting)
                    .font(CrowFont.mono(.title2, weight: .semibold))
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("today.greeting")
                if session.isAvailable(.clock) {
                    clockCard
                    phonePunches
                }
                if session.isAvailable(.schedule) {
                    UpcomingShifts()
                }
            }
            .padding(20)
        }
        .crowScreen()
        .navigationTitle("Today")
        .refreshable { await reload() }
        .task { await reload() }
    }

    private var greeting: String {
        guard let name = session.me?.user.displayName else { return "Hello" }
        return "Hi, \(name.split(separator: " ").first.map(String.init) ?? name)"
    }

    /// Clocked in according to the server, adjusted by punches still waiting on this phone.
    private var clockedIn: Bool {
        let server = state.value?.clockedIn ?? false
        guard let last = session.punches.last(where: \.isPending) else { return server }
        return last.kind == .in
    }

    @ViewBuilder private var clockCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionLabel("Clock in")
            switch state {
            case .loading:
                ProgressView().frame(maxWidth: .infinity)
            case .failed(let e) where e != .offline:
                Notice(text: e.message, tone: .danger, systemImage: "exclamationmark.triangle")
            default:
                HStack(alignment: .firstTextBaseline) {
                    Text(clockedIn ? "Clocked in" : "Not clocked in")
                        .font(CrowFont.mono(.title3, weight: .semibold))
                        .accessibilityIdentifier("clock.status")
                    Spacer()
                    if let last = state.value?.today.last(where: { !$0.voided }), let d = Fmt.parseInstant(last.recordedAt) {
                        Text("\(last.kind == "in" ? "In" : "Out") \(Fmt.time(d))").font(CrowFont.mono(.subheadline)).foregroundStyle(Crow.muted)
                    }
                }
                if state.value == nil {
                    Text("You're offline. Punches are kept on this phone and sent when you're back online.")
                        .font(CrowFont.body(.footnote)).foregroundStyle(Crow.muted)
                }
                if let loc = state.value?.location, loc.mode != "off" {
                    Text(loc.pdpaNotice ?? "Your company records your location when you clock in or out.")
                        .font(CrowFont.body(.footnote)).foregroundStyle(Crow.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Button {
                    Task { await punch() }
                } label: {
                    if busy { ProgressView().tint(Crow.onKuning) } else { Text(clockedIn ? "Clock out" : "Clock in") }
                }
                .buttonStyle(.crowPrimary)
                .disabled(busy || session.me == nil && session.connection.membershipId == nil)
                .accessibilityIdentifier("clock.button")
                if let m = message {
                    Notice(text: m.0, tone: m.1, systemImage: m.1 == .danger ? "exclamationmark.triangle" : "checkmark.circle")
                        .accessibilityIdentifier("clock.message")
                }
                if model.env.isUITest, let outage = model.env.outage {
                    Toggle("Simulate no signal (test only)", isOn: Binding(get: { outage.isOn }, set: { outage.isOn = $0 }))
                        .font(CrowFont.mono(.footnote))
                        .accessibilityIdentifier("debug.outage")
                }
            }
        }
        .crowCard()
    }

    @ViewBuilder private var phonePunches: some View {
        let shown = session.punches.suffix(10).reversed()
        if !shown.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    SectionLabel("On this phone")
                    Spacer()
                    if session.punches.contains(where: \.isPending) {
                        Button("Send now") { Task { await session.drainPunches(force: true); await reload() } }
                            .font(CrowFont.mono(.footnote, weight: .medium))
                            .accessibilityIdentifier("clock.sendNow")
                    }
                }
                ForEach(Array(shown)) { p in PunchRow(punch: p, ownerMatches: p.membershipId == (session.me?.membershipId ?? session.connection.membershipId)) }
            }
        }
    }

    private func reload() async {
        await session.reloadPunches()
        do {
            state = .loaded(try await session.api.get("/api/v1/attendance/me"))
        } catch {
            if case .loaded = state, (error as? APIError) == .offline { return }
            state = .failed(APIError.from(error, host: session.connection.server.host))
        }
    }

    private func punch() async {
        guard let membershipId = session.me?.membershipId ?? session.connection.membershipId else { return }
        busy = true
        defer { busy = false }
        message = nil
        let kind: PunchKind = clockedIn ? .out : .in
        var loc: PunchLocation? = nil
        if let mode = state.value?.location.mode, mode != "off" {
            loc = await location.current()
        }
        do throws(PunchQueueError) {
            try await session.queue.enqueue(kind: kind, membershipId: membershipId, location: loc)
        } catch {
            message = (error.message, .danger)
            return
        }
        await session.drainPunches(force: true)
        let latest = session.punches.last
        switch latest?.outcome {
        case .accepted, .flagged: message = (kind == .in ? "Clocked in." : "Clocked out.", .success)
        case .rejected: message = (latest?.statusLabel() ?? "", .danger)
        default: message = ("Saved on this phone. It will be sent when you're back online.", .warning)
        }
        await reload()
    }
}

struct PunchRow: View {
    let punch: QueuedPunch
    let ownerMatches: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(punch.kind == .in ? "In" : "Out").font(CrowFont.mono(.body, weight: .semibold))
                Text(Fmt.dateTime(punch.deviceTime)).font(CrowFont.mono(.subheadline)).foregroundStyle(Crow.muted)
                Spacer()
                StatusChip(text: chipText, tone: tone)
            }
            Text(punch.statusLabel()).font(CrowFont.body(.footnote)).foregroundStyle(Crow.muted)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("punch.status")
            if let late = punch.lateLabel {
                Text(late).font(CrowFont.body(.footnote, weight: .medium)).foregroundStyle(Crow.warning)
            }
            if !ownerMatches && punch.isPending {
                Text("Made by someone else on this phone. It's sent when they sign in again.")
                    .font(CrowFont.body(.footnote)).foregroundStyle(Crow.muted)
            }
        }
        .padding(12)
        .overlay(RoundedRectangle(cornerRadius: Crow.radius).strokeBorder(Crow.hairline, lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("punch.row")
    }

    private var chipText: String {
        switch punch.outcome {
        case .pending: "Waiting"
        case .accepted: "Synced"
        case .flagged: "Flagged"
        case .rejected: "Not recorded"
        }
    }

    private var tone: Tone {
        switch punch.outcome {
        case .pending: .warning
        case .accepted: .success
        case .flagged: .warning
        case .rejected: .danger
        }
    }
}

struct UpcomingShifts: View {
    @Environment(Session.self) private var session
    @State private var state: LoadState<ScheduleMe> = .loading

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                SectionLabel("Next shifts")
                Spacer()
                NavigationLink("Schedule") { ScheduleView() }.font(CrowFont.mono(.footnote, weight: .medium))
            }
            switch state {
            case .loading: ProgressView()
            case .failed(let e): Text(e.message).font(CrowFont.body(.footnote)).foregroundStyle(Crow.muted)
            case .loaded(let s):
                let next = s.shifts.filter { $0.kind == "shift" }.prefix(3)
                if next.isEmpty {
                    Text("No shifts in the next two weeks.").font(CrowFont.body(.subheadline)).foregroundStyle(Crow.muted)
                } else {
                    ForEach(Array(next)) { ShiftRow(shift: $0) }
                }
            }
        }
        .task {
            do { state = .loaded(try await session.api.get("/api/v1/scheduling/me")) } catch {
                state = .failed(APIError.from(error, host: ""))
            }
        }
    }
}
