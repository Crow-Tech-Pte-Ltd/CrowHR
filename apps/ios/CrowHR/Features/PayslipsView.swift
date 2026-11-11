import PDFKit
import SwiftUI
import UniformTypeIdentifiers

/// Released payslips, read from the server each time (never cached on the phone). A split view:
/// with room (an iPad, landscape or a wide portrait) the list sits beside the selected payslip, the
/// latest at first; on a phone, an iPad at compact widths, or a narrow area beside the iPad
/// sidebar, it collapses to the list that pushes a payslip, as before. Rows are plain buttons, not
/// a `List` (task 3.7): choosing one selects it and, collapsed, shows the payslip column.
struct PayslipsView: View {
    @Environment(Session.self) private var session
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var state: LoadState<[PayslipSummary]> = .loading
    @State private var selection: PayslipSummary.ID?
    @State private var compactColumn: NavigationSplitViewColumn = .sidebar
    @State private var width: CGFloat = 0
    @ScaledMetric(relativeTo: .body) private var listWidth: CGFloat = 340

    /// Room for the list and a readable payslip beside it.
    private var sideBySide: Bool {
        sizeClass == .regular && CrowLayout.payslipsSideBySide(width: width, accessibilityText: typeSize.isAccessibilitySize)
    }

    var body: some View {
        NavigationSplitView(columnVisibility: .constant(.all), preferredCompactColumn: $compactColumn) {
            AsyncContent(state: $state, load: { try await (session.api.get("/api/v1/payslips") as PayslipList).items }) { items in
                RowsScreen {
                    if items.isEmpty {
                        EmptyStateView(title: "No payslips yet", message: "Your payslips appear here once payroll releases them.", systemImage: "doc.text")
                            .padding(.top, 24)
                    } else {
                        RowGroup {
                            ForEach(items) { p in
                                // Side by side, the open payslip's row is kuning-50 (the web's
                                // selected row) and has no chevron: it opens beside, not on top.
                                let selected = sideBySide && selection == p.id
                                Button { open(p) } label: { PayslipRow(payslip: p) }
                                    .buttonStyle(sideBySide ? RowButtonStyle.crowRow : RowButtonStyle.crowNavigationRow)
                                    .background(selected ? Crow.kuningSoft : Color.clear)
                                    .accessibilityAddTraits(selected ? .isSelected : [])
                                    .accessibilityIdentifier("payslip.row")
                            }
                        }
                    }
                }
                .refreshable {
                    if let list: PayslipList = try? await session.api.get("/api/v1/payslips") { state = .loaded(list.items) }
                }
            }
            .crowScreen()
            .navigationTitle("Payslips")
            .navigationBarTitleDisplayMode(.inline)
            // The list column stays: it is the screen's navigation, not a collapsible sidebar.
            .toolbar(removing: .sidebarToggle)
            .navigationSplitViewColumnWidth(min: 300, ideal: min(listWidth, 480), max: 520)
        } detail: {
            if let id = selection, let summary = state.value?.first(where: { $0.id == id }) {
                PayslipDetailView(summary: summary).id(summary.id)
            } else {
                EmptyStateView(title: state.value?.isEmpty == false ? "Choose a payslip" : "No payslip open",
                               message: "The payslip you choose in the list opens here.", systemImage: "doc.text")
                    .frame(maxHeight: .infinity)
                    .crowScreen()
            }
        }
        .navigationSplitViewStyle(.balanced)
        // Too narrow for two columns: collapse as at a compact width (state and selection stay).
        .environment(\.horizontalSizeClass, sideBySide ? sizeClass : .compact)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        // Side by side, open the latest payslip rather than an empty pane.
        .onChange(of: state.value?.first?.id, initial: true) { _, _ in openLatestIfSideBySide() }
        .onChange(of: sideBySide) { _, _ in openLatestIfSideBySide() }
    }

    private func open(_ p: PayslipSummary) {
        selection = p.id
        compactColumn = .detail
    }

    private func openLatestIfSideBySide() {
        guard sideBySide, selection == nil, let first = state.value?.first else { return }
        selection = first.id
    }
}

struct PayslipRow: View {
    let payslip: PayslipSummary
    var body: some View {
        AdaptiveRow {
            VStack(alignment: .leading, spacing: 2) {
                Text(Fmt.monthKey(payslip.month)).font(CrowFont.body(.body, weight: .medium)).foregroundStyle(Crow.ink)
                Text("Paid \(Fmt.dayString(payslip.payDate))\(payslip.revised ? " · revised" : "")")
                    .font(CrowFont.mono(.caption)).foregroundStyle(Crow.muted).fixedSize(horizontal: false, vertical: true)
            }
        } trailing: {
            AmountText(cents: payslip.netPayableCents, weight: .semibold)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(Fmt.monthKey(payslip.month)), paid \(Fmt.dayString(payslip.payDate))\(payslip.revised ? ", revised" : ""), net \(Fmt.moneySpoken(cents: payslip.netPayableCents))")
    }
}

struct PayslipDetailView: View {
    @Environment(Session.self) private var session
    let summary: PayslipSummary
    @State private var state: LoadState<PayslipDetail> = .loading
    @State private var pdf: PayslipPDF?
    @State private var pdfError: String?
    @State private var loadingPDF = false

    var body: some View {
        AsyncContent(state: $state, load: { try await session.api.get("/api/v1/payslips/\(summary.id)") }) { p in
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(p.employer.legalName).font(CrowFont.mono(.footnote)).foregroundStyle(Crow.muted)
                        Text(p.title).font(CrowFont.mono(.title3, weight: .semibold))
                        Text("\(Fmt.dayString(p.periodStart)) – \(Fmt.dayString(p.periodEnd)) · paid \(Fmt.dayString(p.payDate))")
                            .font(CrowFont.mono(.caption)).foregroundStyle(Crow.muted)
                        Text("\(p.employee.name) · \(p.employee.employeeNumber) · \(p.employee.idMasked)")
                            .font(CrowFont.mono(.caption)).foregroundStyle(Crow.muted)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityLabel("\(p.employee.name), employee \(p.employee.employeeNumber), ID ending \(String(p.employee.idMasked.suffix(4)))")
                    }
                    VStack(alignment: .leading, spacing: 10) {
                        AdaptiveRow {
                            Text("Net pay").font(CrowFont.mono(.headline, weight: .semibold))
                        } trailing: {
                            AmountText(cents: p.netPayableCents, style: .title2, weight: .semibold, spoken: true)
                                .accessibilityIdentifier("payslip.net")
                        }
                    }
                    .crowCard()
                    PayGroup(title: "Earnings", lines: earnings(p), total: ("Gross pay", p.grossCents))
                    if !p.deductions.isEmpty {
                        PayGroup(title: "Deductions", lines: p.deductions.map { ($0.label, -$0.amountCents) }, total: ("Total deductions", -p.totalDeductionsCents))
                    }
                    if !p.reimbursements.isEmpty {
                        PayGroup(title: "Reimbursements", lines: p.reimbursements.map { ($0.label, $0.amountCents) }, total: nil)
                    }
                    PayGroup(title: "Employer contributions", lines: [("Employer CPF", p.employerCpfCents)], total: nil)
                    if let pdfError { Notice(text: pdfError, tone: .danger, systemImage: "exclamationmark.triangle") }
                    Button {
                        Task { await openPDF() }
                    } label: {
                        if loadingPDF { ProgressView() } else { Label("View or share PDF", systemImage: "square.and.arrow.up") }
                    }
                    .buttonStyle(.crowSecondary)
                    .accessibilityIdentifier("payslip.pdf")
                    Text("The PDF is downloaded only when you ask for it, and isn't kept on this phone.")
                        .font(CrowFont.body(.footnote)).foregroundStyle(Crow.muted)
                }
                .padding(20)
            }
        }
        .crowScreen()
        .navigationTitle(Fmt.monthKey(summary.month))
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $pdf) { PayslipPDFView(pdf: $0).presentationSizing(.page) }
    }

    private func earnings(_ p: PayslipDetail) -> [(String, Int)] {
        var lines: [(String, Int)] = []
        if let b = p.basic { lines.append(("Basic pay", b.amountCents)) }
        lines += p.allowances.map { ($0.label, $0.amountCents) }
        if let ot = p.overtime { lines.append(("Overtime \(Fmt.quantity(ot.hours)) h", ot.payCents)) }
        lines += p.additional.map { ($0.label, $0.amountCents) }
        return lines
    }

    private func openPDF() async {
        loadingPDF = true
        defer { loadingPDF = false }
        pdfError = nil
        do {
            let (data, _) = try await session.api.raw("GET", "/api/v1/payslips/\(summary.id)/pdf", accept: "application/pdf")
            pdf = PayslipPDF(data: data, name: "payslip-\(summary.month).pdf")
        } catch {
            pdfError = APIError.from(error, host: "").message
        }
    }
}

struct PayGroup: View {
    let title: String
    let lines: [(String, Int)]
    let total: (String, Int)?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(title)
            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                AdaptiveRow {
                    Text(line.0).font(CrowFont.body(.subheadline)).fixedSize(horizontal: false, vertical: true)
                } trailing: {
                    AmountText(cents: line.1, style: .subheadline)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(line.0), \(Fmt.moneySpoken(cents: line.1))")
            }
            if let total {
                Divider().overlay(Crow.hairline)
                AdaptiveRow {
                    Text(total.0).font(CrowFont.body(.subheadline, weight: .medium))
                } trailing: {
                    AmountText(cents: total.1, style: .subheadline, weight: .semibold)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(total.0), \(Fmt.moneySpoken(cents: total.1))")
            }
        }
        .crowCard()
    }
}

/// A payslip PDF held in memory only; shared through the system share sheet on request.
struct PayslipPDF: Identifiable, Transferable {
    let id = UUID()
    let data: Data
    let name: String

    static var transferRepresentation: some TransferRepresentation {
        DataRepresentation(exportedContentType: .pdf) { $0.data }
            .suggestedFileName { $0.name }
    }
}

struct PayslipPDFView: View {
    @Environment(\.dismiss) private var dismiss
    let pdf: PayslipPDF

    var body: some View {
        NavigationStack {
            PDFKitView(data: pdf.data)
                .ignoresSafeArea(edges: .bottom)
                .navigationTitle("Payslip")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() }.keyboardShortcut(.cancelAction) }
                    ToolbarItem(placement: .primaryAction) {
                        ShareLink(item: pdf, preview: SharePreview(pdf.name)) { Label("Share", systemImage: "square.and.arrow.up") }
                    }
                }
        }
    }
}

struct PDFKitView: UIViewRepresentable {
    let data: Data
    func makeUIView(context: Context) -> PDFView {
        let v = PDFView()
        v.autoScales = true
        v.document = PDFDocument(data: data)
        return v
    }
    func updateUIView(_ uiView: PDFView, context: Context) {}
}
