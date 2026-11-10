#if DEBUG
import SwiftUI

/// Task 3.7 investigation, DEBUG and UI tests only (`-uitest -uitest-a11y-lab`): the same app rows
/// (leave balance, leave request, empty state, choice field) built three ways, inside the same tab
/// bar and navigation stack as the real screens, so `A11yAuditLabUITests` can compare Xcode's
/// Dynamic Type audit on identical content in a `List`, a `Form` and a plain `ScrollView`.
/// Fictional data; no server.
struct A11yAuditLabView: View {
    static let balances = [
        LeaveBalance(typeId: "al", code: "AL", name: "Annual leave", unit: "days", tracked: true, eligible: true,
                     childId: nil, entitlement: 14, taken: 0, pending: 0, available: 3),
        LeaveBalance(typeId: "sl", code: "SL", name: "Outpatient sick leave", unit: "days", tracked: true, eligible: true,
                     childId: nil, entitlement: 14, taken: 1, pending: 0, available: 13),
    ]
    static let requests = [
        LeaveRequest(id: "r1", type: .init(id: "al", name: "Annual leave"), startDate: "2026-11-12", endDate: "2026-11-12",
                     startSession: "full", endSession: "full", unit: "days", quantity: 1, reason: nil, status: "pending"),
    ]
    static let options: [(id: String, name: String)] = [("t", "Transport"), ("c", "Client entertainment")]

    @State private var choice = "c"

    var body: some View {
        TabView {
            Tab("List", systemImage: "list.bullet") {
                NavigationStack {
                    List {
                        Section { ForEach(Self.balances) { BalanceRow(balance: $0) } } header: { SectionLabel("Balances") }
                        Section { ForEach(Self.requests) { LeaveRequestRow(request: $0) } } header: { SectionLabel("My leave") }
                        Section { EmptyStateView(title: "No leave yet", message: "Leave you apply for appears here.", systemImage: "calendar") }
                    }
                    .listStyle(.plain)
                    .crowScreen()
                    .navigationTitle("List rows")
                    .navigationBarTitleDisplayMode(.inline)
                }
            }
            Tab("Form", systemImage: "square.and.pencil") {
                NavigationStack {
                    Form {
                        Section { ChoiceField(title: "Type", options: Self.options, selection: $choice) }
                        Section { ForEach(Self.balances) { BalanceRow(balance: $0) } }
                    }
                    .scrollContentBackground(.hidden)
                    .crowScreen()
                    .navigationTitle("Form rows")
                    .navigationBarTitleDisplayMode(.inline)
                }
            }
            Tab("Scroll", systemImage: "scroll") {
                NavigationStack {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 12) {
                            SectionLabel("Balances")
                            ForEach(Self.balances) { BalanceRow(balance: $0); Divider() }
                            SectionLabel("My leave")
                            ForEach(Self.requests) { LeaveRequestRow(request: $0); Divider() }
                            EmptyStateView(title: "No leave yet", message: "Leave you apply for appears here.", systemImage: "calendar")
                            ChoiceField(title: "Type", options: Self.options, selection: $choice)
                        }
                        .padding(20)
                    }
                    .crowScreen()
                    .navigationTitle("Scroll rows")
                    .navigationBarTitleDisplayMode(.inline)
                }
            }
        }
        .tint(Crow.ink)
        .font(CrowFont.body())
        .foregroundStyle(Crow.ink)
    }
}
#endif
