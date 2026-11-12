import SwiftUI

/// Leave → Calendar, as the web's team calendar shows it on a phone: two weeks from a Monday, day
/// by day, who is away (morning, afternoon or all day; approved or pending) and the public
/// holidays. Owners, HR and managers switch between their team ("My team", or "Everyone") and
/// "Who's away", where sensitive types such as sick leave stay private; anyone else sees "Who's
/// away". A row with a request the person may see opens it.
struct TeamCalendarView: View {
    @Environment(Session.self) private var session
    let onOpen: (String) -> Void
    @State private var from = Fmt.mondayOf(Fmt.today())
    @State private var scope: TeamCalendar.Scope?
    @State private var state: LoadState<LeaveCalendar> = .loading

    private var chosenScope: TeamCalendar.Scope { scope ?? TeamCalendar.defaultScope(permissions: session.me?.permissions) }

    var body: some View {
        let scopes = TeamCalendar.scopes(permissions: session.me?.permissions)
        AsyncContent(state: $state, load: load) { cal in
            RowsScreen {
                controls(scopes: scopes)
                let days = TeamCalendar.days(cal)
                if days.isEmpty {
                    EmptyStateView(title: "Nobody is on leave in these two weeks",
                                   message: "Approved leave shows here. Try the next two weeks, or another view.", systemImage: "calendar")
                        .padding(.top, 12)
                } else {
                    ForEach(days) { day in
                        RowGroup(header: header(day)) {
                            if day.away.isEmpty {
                                Text("Public holiday").font(CrowFont.body(.subheadline)).foregroundStyle(Crow.muted).crowRowPadding()
                            }
                            ForEach(day.away, id: \.self) { a in
                                if let id = a.entry.requestId {
                                    Button { onOpen(id) } label: { AwayRow(away: a) }
                                        .buttonStyle(.crowNavigationRow)
                                        .accessibilityIdentifier("calendar.entry")
                                } else {
                                    AwayRow(away: a).crowRowPadding().accessibilityIdentifier("calendar.entry")
                                }
                            }
                        }
                    }
                }
            }
            .refreshable { await reload() }
        }
        .crowScreen()
        .onChange(of: "\(from)|\(chosenScope.rawValue)") { _, _ in
            state = .loading
            Task { await reload() }
        }
    }

    private func controls(scopes: [(id: TeamCalendar.Scope, name: String)]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(Fmt.dateRange(from, Fmt.addDays(from, TeamCalendar.span - 1)))
                .font(CrowFont.mono(.headline, weight: .semibold))
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("calendar.range")
            HStack(spacing: 8) {
                Button { from = Fmt.addDays(from, -TeamCalendar.span) } label: { Image(systemName: "chevron.left") }
                    .buttonStyle(.crowCompact)
                    .accessibilityLabel("Previous two weeks")
                    .accessibilityIdentifier("calendar.previous")
                Button { from = Fmt.addDays(from, TeamCalendar.span) } label: { Image(systemName: "chevron.right") }
                    .buttonStyle(.crowCompact)
                    .accessibilityLabel("Next two weeks")
                    .accessibilityIdentifier("calendar.next")
                Button("This week") { from = Fmt.mondayOf(Fmt.today()) }
                    .buttonStyle(.crowCompact)
                    .accessibilityIdentifier("calendar.thisWeek")
            }
            if !scopes.isEmpty {
                SegmentedChoice(title: "Calendar view", options: scopes,
                                selection: Binding(get: { chosenScope }, set: { scope = $0 }))
                    .accessibilityIdentifier("calendar.scope")
            }
            Text(chosenScope == .org
                ? "Who's away. Leave types stay private where they're sensitive, such as sick leave."
                : "Your team's leave by half day, pending requests included.")
                .font(CrowFont.body(.footnote)).foregroundStyle(Crow.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
    }

    /// "Mon 16 Nov 2026 · Deepavali".
    private func header(_ day: TeamCalendar.Day) -> String {
        let date = "\(Fmt.weekday(day.date)) \(Fmt.dayString(day.date))"
        return day.holiday.map { "\(date) · \($0)" } ?? date
    }

    private func load() async throws -> LeaveCalendar {
        try await session.api.get("/api/v1/leave/calendar", query: TeamCalendar.query(from: from, scope: chosenScope))
    }

    private func reload() async {
        do { state = .loaded(try await load()) } catch { state.fail(error) }
    }
}

/// Who is away and why: the name ("(you)" for oneself), the leave (and which half), and whether
/// it is approved or still pending.
private struct AwayRow: View {
    let away: TeamCalendar.Day.Away

    var body: some View {
        AdaptiveRow {
            VStack(alignment: .leading, spacing: 2) {
                Text(away.name + (away.isSelf ? " (you)" : "")).font(CrowFont.body(.body, weight: .medium)).foregroundStyle(Crow.ink)
                    .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                Text([away.entry.label, TeamCalendar.half(away.entry.session)].compactMap { $0 }.joined(separator: " · "))
                    .font(CrowFont.body(.subheadline)).foregroundStyle(Crow.muted)
                    .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
            }
        } trailing: {
            StatusChip(text: away.entry.status == "pending" ? "Pending" : "Approved", tone: away.entry.status == "pending" ? .warning : .success)
        }
        .accessibilityElement(children: .combine)
    }
}
