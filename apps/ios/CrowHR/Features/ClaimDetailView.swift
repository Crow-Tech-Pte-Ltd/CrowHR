import SwiftUI

/// One claim, read from the server, as the web's claim page shows it: the expenses with each
/// foreign amount and its rate beside the SGD amount, the total, how it is paid, the approver's
/// comment on a rejection, and what can be done with it now (submit a saved draft, withdraw a
/// waiting claim, delete a draft).
struct ClaimDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(Session.self) private var session
    let id: String
    /// The claim changed or went: the list reloads.
    let onChange: () -> Void
    @State private var state: LoadState<ClaimDetail> = .loading
    @State private var busy: String?
    @State private var notice: (text: String, tone: Tone)?
    @State private var confirmDelete = false

    var body: some View {
        AsyncContent(state: $state, load: load) { c in
            RowsScreen {
                header(c)
                if let notice {
                    Notice(text: notice.text, tone: notice.tone, systemImage: notice.tone == .success ? "checkmark.circle" : "exclamationmark.triangle")
                        .padding(.horizontal, 16)
                        .accessibilityIdentifier("claimDetail.notice")
                }
                if c.status == "rejected", let comment = c.decisionComment, !comment.isEmpty {
                    Notice(text: "Not approved: \(comment)", tone: .danger, systemImage: "exclamationmark.triangle")
                        .padding(.horizontal, 16)
                }
                RowGroup(header: c.lines.count == 1 ? "Expense" : "Expenses") {
                    ForEach(c.lines) { ClaimLineRow(line: $0).crowRowPadding() }
                    AdaptiveRow {
                        SectionLabel("Total")
                    } trailing: {
                        AmountText(cents: c.totalCents, style: .title3, weight: .semibold)
                    }
                    .crowRowPadding()
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("Total, \(Fmt.moneySpoken(cents: c.totalCents))")
                    .accessibilityIdentifier("claimDetail.total")
                }
                RowGroup {
                    InfoRow("Payout", c.payout)
                    if let s = c.submittedAt { InfoRow("Submitted", Fmt.dayString(s)) }
                    if let a = c.approvedOn { InfoRow("Approved", Fmt.dayString(a)) }
                }
                actions(c)
            }
            .refreshable { await reload() }
        }
        .crowScreen()
        .navigationTitle("Claim")
        .navigationBarTitleDisplayMode(.inline)
        .alert("Delete this draft?", isPresented: $confirmDelete) {
            Button("Delete", role: .destructive) { Task { await act("delete") } }
            Button("Keep it", role: .cancel) {}
        } message: {
            Text("The draft and its receipts are removed. This can't be undone.")
        }
    }

    private func header(_ c: ClaimDetail) -> some View {
        let (label, tone) = ClaimSummary.statusLabel(c.status)
        return VStack(alignment: .leading, spacing: 6) {
            Text(c.claimNumber ?? "Draft").font(CrowFont.mono(.caption, weight: .medium)).foregroundStyle(Crow.muted)
            Text(c.heading).font(CrowFont.mono(.title3, weight: .semibold)).fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("claimDetail.title")
            StatusChip(text: label, tone: tone)
        }
        .crowRowPadding(vertical: 16)
    }

    @ViewBuilder private func actions(_ c: ClaimDetail) -> some View {
        if c.actions.submit || c.actions.withdraw || c.actions.delete {
            VStack(spacing: 12) {
                if c.actions.submit {
                    Button { Task { await act("submit") } } label: { Text(busy == "submit" ? "Sending…" : "Submit claim") }
                        .buttonStyle(.crowPrimary)
                        .disabled(busy != nil)
                        .accessibilityIdentifier("claimDetail.submit")
                }
                if c.actions.withdraw {
                    Button("Withdraw") { Task { await act("withdraw") } }
                        .buttonStyle(.crowSecondary)
                        .disabled(busy != nil)
                        .accessibilityHint("Takes the claim back from your approver")
                        .accessibilityIdentifier("claimDetail.withdraw")
                }
                if c.actions.delete {
                    Button("Delete draft") { confirmDelete = true }
                        .buttonStyle(.crowDanger)
                        .disabled(busy != nil)
                        .accessibilityIdentifier("claimDetail.delete")
                }
            }
            .padding(16)
        }
    }

    private func load() async throws -> ClaimDetail { try await session.api.get("/api/v1/claims/\(id)") }

    private func reload() async {
        do { state = .loaded(try await load()) } catch { state.fail(error) }
    }

    private func act(_ action: String) async {
        busy = action
        defer { busy = nil }
        notice = nil
        do {
            if action == "delete" {
                _ = try await session.api.raw("DELETE", "/api/v1/claims/\(id)")
                onChange()
                dismiss()
                return
            }
            let c: ClaimDetail = try await session.api.post("/api/v1/claims/\(id)/\(action)")
            state = .loaded(c)
            notice = (action == "submit" ? "Claim \(c.claimNumber ?? "") sent for approval." : "Claim withdrawn.", .success)
            onChange()
        } catch {
            notice = (APIError.from(error, host: "").message, .danger)
        }
    }
}

/// One expense: type, date, where and what; the SGD amount, and for a foreign currency the amount
/// and rate under it ("MYR 125.50 @ 0.301234").
struct ClaimLineRow: View {
    let line: ClaimDetail.Line

    var body: some View {
        AdaptiveRow {
            VStack(alignment: .leading, spacing: 2) {
                Text(line.typeName).font(CrowFont.body(.body, weight: .medium)).fixedSize(horizontal: false, vertical: true)
                Text(Fmt.dayString(line.expenseDate)).font(CrowFont.mono(.caption)).foregroundStyle(Crow.muted)
                Text(what).font(CrowFont.body(.subheadline)).foregroundStyle(Crow.muted).fixedSize(horizontal: false, vertical: true)
                if let receipts {
                    Text(receipts.text).font(CrowFont.body(.footnote)).foregroundStyle(receipts.missing ? Crow.danger : Crow.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        } trailing: {
            VStack(alignment: .trailing, spacing: 2) {
                AmountText(cents: line.sgdCents, weight: .semibold)
                if let foreign { Text(foreign).font(CrowFont.mono(.caption)).foregroundStyle(Crow.muted) }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(spoken)
        .accessibilityIdentifier("claimDetail.line")
    }

    /// "MYR 125.50 @ 0.301234" for a foreign amount.
    var foreign: String? {
        guard line.currency != "SGD" else { return nil }
        return ClaimMoney.foreignAmount(currency: line.currency, amountMinor: line.amountMinor) + (line.rate.map { " @ \($0)" } ?? "")
    }

    private var what: String {
        if let hidden = line.redactedFields, !hidden.isEmpty {
            return "Details are only shown to HR, the employee and the current approver."
        }
        return [line.merchant, line.description].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private var receipts: (text: String, missing: Bool)? {
        if line.receiptCount > 0 { return (line.receiptCount == 1 ? "1 receipt" : "\(line.receiptCount) receipts", false) }
        if line.receiptRequired && (line.redactedFields ?? []).isEmpty { return ("A receipt is required for this expense.", true) }
        return nil
    }

    private var spoken: String {
        [line.typeName, Fmt.dayString(line.expenseDate), what, Fmt.moneySpoken(cents: line.sgdCents),
         foreign.map { "from \($0.replacingOccurrences(of: " @ ", with: " at a rate of "))" }, receipts?.text]
            .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
    }
}
