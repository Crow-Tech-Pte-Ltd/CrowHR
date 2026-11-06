import PhotosUI
import SwiftUI

/// A photo taken for a receipt or leave document, kept in memory until it's uploaded.
struct CapturedImage: Equatable {
    let id = UUID()
    let image: UIImage
    var jpeg: Data? { image.jpegData(compressionQuality: 0.7) }
}

/// The camera (UIImagePickerController). In UI tests on the simulator, which has no camera,
/// `-uitest-camera-stub` returns a drawn receipt instead; Release builds have no stub.
struct CameraCapture: View {
    let stub: Bool
    let onImage: (CapturedImage) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        if stub {
            VStack(spacing: 16) {
                Text("Test camera").font(CrowFont.mono(.headline, weight: .semibold))
                Button("Take photo") { onImage(CapturedImage(image: Self.stubReceipt())) }
                    .buttonStyle(.crowPrimary)
                    .accessibilityIdentifier("camera.shutter")
            }
            .padding(24)
        } else if UIImagePickerController.isSourceTypeAvailable(.camera) {
            ImagePicker { image in
                if let image { onImage(CapturedImage(image: image)) } else { dismiss() }
            }
            .ignoresSafeArea()
        } else {
            EmptyStateView(title: "No camera", message: "This device has no camera. Choose a photo instead.", systemImage: "camera")
        }
    }

    static func stubReceipt() -> UIImage {
        let size = CGSize(width: 600, height: 800)
        return UIGraphicsImageRenderer(size: size).image { ctx in
            UIColor.white.setFill()
            ctx.fill(CGRect(origin: .zero, size: size))
            let attrs: [NSAttributedString.Key: Any] = [.font: UIFont.monospacedSystemFont(ofSize: 28, weight: .regular), .foregroundColor: UIColor.black]
            ("KOPI KAKI CAFE\n\nKopi O        S$1.80\nKaya toast    S$3.20\n\nTOTAL         S$5.00\n\nTEST RECEIPT" as NSString)
                .draw(in: CGRect(x: 40, y: 60, width: 520, height: 700), withAttributes: attrs)
        }
    }
}

struct ImagePicker: UIViewControllerRepresentable {
    let onFinish: (UIImage?) -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let p = UIImagePickerController()
        p.sourceType = .camera
        p.delegate = context.coordinator
        return p
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(onFinish: onFinish) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onFinish: (UIImage?) -> Void
        init(onFinish: @escaping (UIImage?) -> Void) { self.onFinish = onFinish }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            onFinish(info[.originalImage] as? UIImage)
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { onFinish(nil) }
    }
}

struct ClaimsView: View {
    @Environment(Session.self) private var session
    @State private var state: LoadState<[ClaimSummary]> = .loading
    @State private var creating = false

    var body: some View {
        AsyncContent(state: $state, load: load) { claims in
            if claims.isEmpty {
                EmptyStateView(title: "No claims yet", message: "Claim back work expenses like transport and meals. Snap the receipt with your camera.", systemImage: "receipt")
            } else {
                List(claims) { ClaimRow(claim: $0) }
                    .listStyle(.plain)
                    .refreshable { await reload() }
            }
        }
        .crowScreen()
        .navigationTitle("Claims")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { creating = true } label: { Label("New claim", systemImage: "plus") }
                    .accessibilityIdentifier("claims.new")
            }
        }
        .sheet(isPresented: $creating) { NewClaimView { Task { await reload() } } }
    }

    private func load() async throws -> [ClaimSummary] {
        try await (session.api.get("/api/v1/claims", query: [URLQueryItem(name: "mine", value: "true"), URLQueryItem(name: "pageSize", value: "50"), URLQueryItem(name: "sort", value: "-createdAt")]) as ClaimPage).items
    }

    private func reload() async {
        do { state = .loaded(try await load()) } catch { state = .failed(APIError.from(error, host: "")) }
    }
}

struct ClaimRow: View {
    let claim: ClaimSummary
    var body: some View {
        let (label, tone) = claim.statusLabel
        AdaptiveRow {
            VStack(alignment: .leading, spacing: 2) {
                Text(claim.title ?? claim.typeNames.joined(separator: ", ")).font(CrowFont.body(.body, weight: .medium)).fixedSize(horizontal: false, vertical: true)
                Text([claim.claimNumber, claim.expenseFrom.map(Fmt.dayString)].compactMap { $0 }.joined(separator: " · "))
                    .font(CrowFont.mono(.caption)).foregroundStyle(Crow.muted).fixedSize(horizontal: false, vertical: true)
            }
        } trailing: {
            VStack(alignment: .leading, spacing: 4) {
                MoneyText(cents: claim.totalCents, weight: .semibold)
                StatusChip(text: label, tone: tone)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("claim.row")
    }
}

/// One-line claim in SGD with a camera receipt. Saved as a draft or submitted.
struct NewClaimView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(Session.self) private var session
    @Environment(AppModel.self) private var model
    let onDone: () -> Void

    @State private var types: LoadState<[ClaimType]> = .loading
    @State private var typeID = ""
    @State private var date = Date()
    @State private var merchant = ""
    @State private var detail = ""
    @State private var amount = ""
    @State private var receipt: CapturedImage?
    @State private var showCamera = false
    @State private var picked: PhotosPickerItem?
    @State private var busy = false
    @State private var error: String?

    private var selectedType: ClaimType? { types.value?.first { $0.id == typeID } }
    private var cents: Int? { Fmt.parseCents(amount) }

    private var receiptRequired: Bool {
        guard let t = selectedType else { return false }
        switch t.receiptRule {
        case "always": return true
        case "above": return (cents ?? 0) > (t.receiptAboveCents ?? 0)
        default: return false
        }
    }

    var body: some View {
        NavigationStack {
            AsyncContent(state: $types, load: loadTypes) { list in
                Form {
                    Section {
                        Picker("Type", selection: $typeID) { ForEach(list) { Text($0.name).tag($0.id) } }
                            .adaptivePickerStyle()
                            .accessibilityIdentifier("claim.type")
                        DatePicker("Date", selection: $date, in: ...Date(), displayedComponents: .date)
                        TextField("Merchant", text: $merchant).accessibilityIdentifier("claim.merchant")
                        TextField("What was it for?", text: $detail).accessibilityIdentifier("claim.description")
                        HStack {
                            Text("Amount")
                            Spacer()
                            Text("S$").font(CrowFont.mono(.body)).foregroundStyle(Crow.muted)
                            TextField("0.00", text: $amount)
                                .keyboardType(.decimalPad)
                                .multilineTextAlignment(.trailing)
                                .font(CrowFont.mono(.body))
                                .frame(maxWidth: 140)
                                .accessibilityLabel("Amount in Singapore dollars")
                                .accessibilityIdentifier("claim.amount")
                        }
                        if !amount.isEmpty && cents == nil {
                            Text("Enter an amount like 12.50 (dollars and cents).").font(CrowFont.body(.footnote)).foregroundStyle(Crow.danger)
                        }
                    } footer: {
                        // NOT IMPLEMENTED (app): foreign-currency lines and multi-line claims are on the web.
                        Text("Claims in other currencies, or with several lines, can be made in Crow HR on the web.")
                    }
                    Section {
                        if let receipt {
                            HStack {
                                Image(uiImage: receipt.image).resizable().scaledToFit().frame(height: 80)
                                    .accessibilityLabel("Receipt photo").accessibilityIdentifier("claim.receiptPreview")
                                Spacer()
                                Button("Remove", role: .destructive) { self.receipt = nil }
                            }
                        } else {
                            Button { showCamera = true } label: { Label("Photograph receipt", systemImage: "camera") }
                                .accessibilityIdentifier("claim.camera")
                            PhotosPicker(selection: $picked, matching: .images) { Label("Choose a photo", systemImage: "photo").font(CrowFont.body()) }
                        }
                    } header: {
                        Text(receiptRequired ? "Receipt (required)" : "Receipt")
                    } footer: {
                        if let hint = selectedType?.receiptHint, !hint.isEmpty { Text(hint) }
                    }
                    if let error { Section { Text(error).foregroundStyle(Crow.danger).accessibilityIdentifier("claim.error") } }
                    Section {
                        Button { Task { await save(submit: true) } } label: { Text(busy ? "Sending…" : "Submit claim") }
                            .buttonStyle(.crowPrimary)
                            .disabled(!valid || busy)
                            .listRowInsets(EdgeInsets())
                            .listRowBackground(Color.clear)
                            .accessibilityIdentifier("claim.submit")
                        Button("Save as draft") { Task { await save(submit: false) } }
                            .disabled(!valid || busy)
                            .accessibilityIdentifier("claim.draft")
                    }
                }
                .scrollContentBackground(.hidden)
            }
            .crowScreen()
            .navigationTitle("New claim")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .sheet(isPresented: $showCamera) {
                CameraCapture(stub: model.env.cameraStub) { receipt = $0; showCamera = false }
            }
            .onChange(of: picked) { _, item in
                guard let item else { return }
                Task {
                    if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) { receipt = CapturedImage(image: image) }
                }
            }
        }
    }

    private var valid: Bool {
        selectedType != nil && cents != nil && !merchant.trimmingCharacters(in: .whitespaces).isEmpty
            && !detail.trimmingCharacters(in: .whitespaces).isEmpty && (!receiptRequired || receipt != nil)
    }

    private func loadTypes() async throws -> [ClaimType] {
        let list: ClaimTypeList = try await session.api.get("/api/v1/claims/eligible-types", query: [URLQueryItem(name: "date", value: Fmt.day(Date()))])
        if typeID.isEmpty { typeID = list.items.first?.id ?? "" }
        return list.items
    }

    private func save(submit: Bool) async {
        guard let cents else { return }
        busy = true
        defer { busy = false }
        error = nil
        do {
            var receiptIDs: [String] = []
            if let jpeg = receipt?.jpeg {
                let (data, _) = try await session.api.raw("POST", "/api/v1/claims/receipts", query: [URLQueryItem(name: "fileName", value: "receipt.jpg")], body: jpeg, contentType: "image/jpeg")
                receiptIDs.append(try JSONDecoder().decode(ReceiptUpload.self, from: data).id)
            }
            let claim = NewClaim(title: nil, lines: [.init(claimTypeId: typeID, expenseDate: Fmt.day(date), merchant: merchant.trimmingCharacters(in: .whitespaces), description: detail.trimmingCharacters(in: .whitespaces), currency: "SGD", amountMinor: cents, receiptIds: receiptIDs)], submit: submit)
            let _: CreatedClaim = try await session.api.post("/api/v1/claims", json: claim)
            onDone()
            dismiss()
        } catch {
            self.error = APIError.from(error, host: "").message
        }
    }
}

struct ScheduleView: View {
    @Environment(Session.self) private var session
    @State private var state: LoadState<ScheduleMe> = .loading

    var body: some View {
        AsyncContent(state: $state, load: { try await session.api.get("/api/v1/scheduling/me") }) { s in
            if s.shifts.isEmpty {
                EmptyStateView(title: "No shifts published", message: "Your published shifts for the next two weeks appear here.", systemImage: "calendar")
            } else {
                List(s.shifts) { ShiftRow(shift: $0) }
                    .listStyle(.plain)
            }
        }
        .crowScreen()
        .navigationTitle("My schedule")
    }
}

struct ShiftRow: View {
    let shift: ScheduleMe.Shift
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
        .accessibilityIdentifier("shift.row")
    }
}
