import PDFKit
import SwiftUI
import UniformTypeIdentifiers

/// Released payslips, read from the server each time (never cached on the phone).
struct PayslipsView: View {
    @Environment(Session.self) private var session
    @State private var state: LoadState<[PayslipSummary]> = .loading

    var body: some View {
        AsyncContent(state: $state, load: { try await (session.api.get("/api/v1/payslips") as PayslipList).items }) { items in
            RowsScreen {
                if items.isEmpty {
                    EmptyStateView(title: "No payslips yet", message: "Your payslips appear here once payroll releases them.", systemImage: "doc.text")
                        .padding(.top, 24)
                } else {
                    RowGroup {
                        ForEach(items) { p in
                            NavigationLink { PayslipDetailView(summary: p) } label: { PayslipRow(payslip: p) }
                                .buttonStyle(.crowNavigationRow)
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
        .sheet(item: $pdf) { PayslipPDFView(pdf: $0) }
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
                    ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
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
