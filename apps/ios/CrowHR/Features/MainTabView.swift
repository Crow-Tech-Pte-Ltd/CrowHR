import SwiftUI

/// The tab bar on a phone: Today, Leave, Pay, Inbox and More. On an iPad (regular width) a sidebar
/// in landscape and iPadOS's floating tab bar in portrait (`sidebarAdaptable`; the user can switch),
/// with no More: the sidebar lists every screen, and the floating bar (which fits about six) the
/// main ones, Claims included, with its sidebar button for Schedule, Profile and Settings. At
/// compact widths (Split View, Slide Over, a narrow window) the iPad shows the phone's tabs, and a
/// screen only the wide layout lists moves under More (`TabRouting`). The tab set follows the width
/// class rather than `defaultVisibility(_:for:)`, which iPadOS 27's floating tab bar doesn't apply
/// without tab customization.
struct MainTabView: View {
    @Environment(AppModel.self) private var model
    @Environment(Session.self) private var session
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        @Bindable var model = model
        let sidebar = sizeClass == .regular
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
                // A split view (list beside detail on an iPad) holds its own navigation stacks.
                Tab(sidebar ? "Payslips" : "Pay", systemImage: "doc.text", value: MainTab.pay) {
                    PayslipsView()
                }
                .accessibilityIdentifier("tab.pay")
            }
            Tab("Inbox", systemImage: "tray", value: MainTab.inbox) {
                NavigationStack { InboxView() }
            }
            .accessibilityIdentifier("tab.inbox")
            if sidebar {
                // iPad, regular width: More's screens are tabs of their own.
                if session.isAvailable(.claims) {
                    Tab("Claims", systemImage: "receipt", value: MainTab.claims) {
                        NavigationStack { ClaimsView() }
                    }
                    .accessibilityIdentifier("tab.claims")
                }
                if session.isAvailable(.schedule) {
                    Tab("Schedule", systemImage: "calendar.day.timeline.left", value: MainTab.schedule) {
                        NavigationStack { ScheduleView() }
                    }
                    .tabPlacement(.sidebarOnly)
                    .accessibilityIdentifier("tab.schedule")
                }
                Tab("Profile", systemImage: "person", value: MainTab.profile) {
                    NavigationStack { ProfileView() }
                }
                .tabPlacement(.sidebarOnly)
                .accessibilityIdentifier("tab.profile")
                Tab("Settings", systemImage: "gearshape", value: MainTab.settings) {
                    NavigationStack { SettingsView() }
                }
                .tabPlacement(.sidebarOnly)
                .accessibilityIdentifier("tab.settings")
            } else {
                // Phone, and iPad at compact widths.
                Tab("More", systemImage: "ellipsis", value: MainTab.more) {
                    NavigationStack(path: $model.morePath) { MoreView() }
                }
                .accessibilityIdentifier("tab.more")
            }
        }
        .tabViewStyle(.sidebarAdaptable)
        // iPad: the sidebar where it fits (landscape), rather than the floating tab bar. No
        // effect on a phone.
        .defaultTabBarPlacement(.sidebar)
        // The header is hosted outside this view's environment: pass the session in.
        .tabViewSidebarHeader { SidebarHeader(session: session) }
        .tint(Crow.ink)
        .background { GoShortcuts(model: model) }
        .onAppear { model.sidebarChanged(sidebar) }
        .onChange(of: sidebar) { _, available in model.sidebarChanged(available) }
    }
}

/// Hardware-keyboard shortcuts to the main screens (an iPad's keyboard; hold Command to list them):
/// invisible buttons in the main view, so they work wherever the signed-in app has focus.
/// `AppModel.go(to:)` ignores a screen the server doesn't offer, and opens a screen the tab bar
/// doesn't show under More.
struct GoShortcuts: View {
    let model: AppModel

    static let items: [(title: String, key: KeyEquivalent, tab: MainTab)] = [
        ("Today", "1", .today), ("Leave", "2", .leave), ("Payslips", "3", .pay), ("Inbox", "4", .inbox),
        ("Claims", "5", .claims), ("Schedule", "6", .schedule), ("My profile", "7", .profile), ("Settings", "8", .settings),
    ]

    var body: some View {
        ZStack {
            ForEach(Self.items.indices, id: \.self) { i in
                let item = Self.items[i]
                Button(item.title) { model.go(to: item.tab) }
                    .keyboardShortcut(item.key, modifiers: .command)
            }
        }
        .frame(width: 0, height: 0)
        .opacity(0)
        .accessibilityHidden(true)
    }
}

/// Top of the iPad sidebar: the brand chip, the organisation and who is signed in.
struct SidebarHeader: View {
    let session: Session

    var body: some View {
        HStack(spacing: 12) {
            CrowMark(size: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text(session.connection.orgName)
                    .font(CrowFont.mono(.subheadline, weight: .semibold))
                    .foregroundStyle(Crow.ink)
                    .fixedSize(horizontal: false, vertical: true)
                if let name = session.me?.user.displayName {
                    Text(name).font(CrowFont.body(.footnote)).foregroundStyle(Crow.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("sidebar.header")
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

    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var width: CGFloat = 0

    var body: some View {
        // A wide iPad puts the next shifts beside the clock card. One `AnyLayout` for both, so
        // rotating or resizing keeps each part's state.
        let wide = CrowLayout.todayIsWide(width: width, accessibilityText: typeSize.isAccessibilitySize)
        let columns = wide ? AnyLayout(HStackLayout(alignment: .top, spacing: 28)) : AnyLayout(VStackLayout(alignment: .leading, spacing: 20))
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text(greeting)
                    .font(CrowFont.mono(.title2, weight: .semibold))
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("today.greeting")
                columns {
                    if session.isAvailable(.clock) {
                        VStack(alignment: .leading, spacing: 20) {
                            clockCard
                            phonePunches
                        }
                        .frame(maxWidth: wide ? .infinity : nil, alignment: .topLeading)
                    }
                    if session.isAvailable(.schedule) {
                        UpcomingShifts(limit: wide ? 6 : 3)
                            .frame(maxWidth: wide ? .infinity : nil, alignment: .topLeading)
                    }
                }
            }
            // The column's own width (inside margins and safe areas, such as the iPad sidebar).
            .frame(maxWidth: .infinity, alignment: .leading)
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
            .padding(20)
        }
        .crowScreen(maxWidth: CrowLayout.wideWidth)
        .navigationTitle("Today")
        .navigationBarTitleDisplayMode(.inline)
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
                AdaptiveRow {
                    Text(clockedIn ? "Clocked in" : "Not clocked in")
                        .font(CrowFont.mono(.title3, weight: .semibold))
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("clock.status")
                } trailing: {
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
                if model.env.isUITest, !model.env.storeScreenshots, let outage = model.env.outage {
                    Toggle("Simulate no signal (test only)", isOn: Binding(get: { outage.isOn }, set: { outage.isOn = $0 }))
                        .font(CrowFont.mono(.footnote))
                        .accessibilityIdentifier("debug.outage")
                }
            }
        }
        .crowCard()
    }

    @ViewBuilder private var phonePunches: some View {
        // Refused punches stay until dismissed; otherwise the latest ten.
        let attention = session.punches.filter(\.needsAttention)
        let recent = session.punches.filter { !$0.needsAttention && $0.dismissedAt == nil }.suffix(10)
        let shown = (attention + recent).sorted { $0.deviceTime > $1.deviceTime }
        if !shown.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                // Stacked at accessibility sizes, so "Send now" never breaks mid-word.
                AdaptiveRow {
                    SectionLabel("On this phone")
                } trailing: {
                    if session.punches.contains(where: \.isPending) {
                        Button("Send now") { Task { await session.drainPunches(force: true); await reload() } }
                            .font(CrowFont.mono(.footnote, weight: .medium))
                            .accessibilityIdentifier("clock.sendNow")
                    }
                }
                ForEach(shown) { p in
                    PunchRow(punch: p, ownerMatches: p.membershipId == (session.me?.membershipId ?? session.connection.membershipId)) {
                        Task { await session.queue.dismiss(p.id); await session.reloadPunches() }
                    }
                }
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
    var onDismiss: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            AdaptiveRow {
                Text("\(punch.kind == .in ? "In" : "Out")  \(Fmt.dateTime(punch.deviceTime))").font(CrowFont.mono(.body, weight: .semibold))
                    .fixedSize(horizontal: false, vertical: true)
            } trailing: {
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
            if punch.needsAttention {
                Button("Dismiss", action: onDismiss)
                    .font(CrowFont.mono(.footnote, weight: .medium))
                    .accessibilityLabel("Dismiss this refused punch")
                    .accessibilityIdentifier("punch.dismiss")
            }
        }
        .padding(12)
        .overlay(RoundedRectangle(cornerRadius: Crow.radius).strokeBorder(Crow.hairline, lineWidth: 1))
        .accessibilityElement(children: punch.needsAttention ? .contain : .combine)
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
    /// Three on a phone; more beside the clock card on a wide iPad.
    var limit = 3

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Stacked at accessibility sizes: beside the label, "Schedule" broke mid-word at XXXL.
            AdaptiveRow {
                SectionLabel("Next shifts")
            } trailing: {
                NavigationLink("Schedule") { ScheduleView() }.font(CrowFont.mono(.footnote, weight: .medium))
            }
            switch state {
            case .loading: ProgressView()
            case .failed(let e): Text(e.message).font(CrowFont.body(.footnote)).foregroundStyle(Crow.muted)
            case .loaded(let s):
                let next = s.shifts.filter { $0.kind == "shift" }.prefix(limit)
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
