import ImageIO
import PhotosUI
import SwiftUI

/// A photo taken for a receipt or leave document, kept in memory until it's uploaded. Only the
/// upload-sized copy is kept, made once off the main thread when the photo arrives: a full 24- or
/// 48-megapixel photo takes 100 to 200 MB decoded, and scaling and encoding it on the main thread
/// at Submit held up the screen.
struct CapturedImage: Equatable {
    let id = UUID()
    /// The upload as an image, for the preview.
    let image: UIImage
    /// The upload: JPEG at 0.7, at most `maxUploadPixels` on the long side, upright.
    let jpeg: Data?
    /// Sent at most 2,400 px on the long side: a receipt or MC stays legible, while a full 24- or
    /// 48-megapixel photo is several megabytes on mobile data and can pass the server's 10 MB
    /// receipt limit.
    static let maxUploadPixels: CGFloat = 2400
    static let jpegQuality: CGFloat = 0.7

    private init(image: UIImage, jpeg: Data?) {
        self.image = image
        self.jpeg = jpeg
    }

    /// UIImage is immutable and safe to use on any thread.
    private struct SendableImage: @unchecked Sendable { let image: UIImage }

    /// From the camera (or the UI-test stub): scaled and encoded off the main thread.
    static func make(camera original: UIImage) async -> CapturedImage {
        let box = SendableImage(image: original)
        let jpeg = await Task.detached(priority: .userInitiated) {
            forUpload(box.image).jpegData(compressionQuality: jpegQuality)
        }.value
        return CapturedImage(image: jpeg.flatMap { UIImage(data: $0) } ?? original, jpeg: jpeg)
    }

    /// From the photo library's data: decoded straight at the upload size (never at full size),
    /// upright, off the main thread. Nil when it isn't an image.
    static func make(data: Data) async -> CapturedImage? {
        let jpeg = await Task.detached(priority: .userInitiated) { () -> Data? in
            let options: [CFString: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceShouldCacheImmediately: true,
                kCGImageSourceThumbnailMaxPixelSize: Int(maxUploadPixels),
            ]
            guard let source = CGImageSourceCreateWithData(data as CFData, nil),
                  let scaled = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
            return UIImage(cgImage: scaled).jpegData(compressionQuality: jpegQuality)
        }.value
        guard let jpeg, let image = UIImage(data: jpeg) else { return nil }
        return CapturedImage(image: image, jpeg: jpeg)
    }

    /// The photo scaled down to `maxUploadPixels` (upright: drawing applies its orientation).
    static func forUpload(_ image: UIImage) -> UIImage {
        let width = image.size.width * image.scale, height = image.size.height * image.scale
        let longest = max(width, height)
        guard longest > maxUploadPixels else { return image }
        let factor = maxUploadPixels / longest
        let size = CGSize(width: (width * factor).rounded(), height: (height * factor).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
    }
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
                Button("Take photo") { Task { onImage(await CapturedImage.make(camera: Self.stubReceipt())) } }
                    .buttonStyle(.crowPrimary)
                    .accessibilityIdentifier("camera.shutter")
            }
            .padding(24)
        } else if UIImagePickerController.isSourceTypeAvailable(.camera) {
            ImagePicker { image in
                if let image { Task { onImage(await CapturedImage.make(camera: image)) } } else { dismiss() }
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
    @Environment(AppModel.self) private var model
    @Environment(Session.self) private var session
    @State private var state: LoadState<[ClaimSummary]> = .loading
    @State private var creating = false
    /// The claim open in its own screen (a row, or a notification about it).
    @State private var opened: String?

    var body: some View {
        AsyncContent(state: $state, load: load) { claims in
            RowsScreen {
                if claims.isEmpty {
                    EmptyStateView(title: "No claims yet", message: "Claim back work expenses like transport and meals. Snap the receipt with your camera.", systemImage: "receipt")
                        .padding(.top, 24)
                } else {
                    RowGroup {
                        ForEach(claims) { c in
                            Button { opened = c.id } label: { ClaimRow(claim: c) }
                                .buttonStyle(.crowNavigationRow)
                                .accessibilityIdentifier("claim.row")
                        }
                    }
                }
            }
            .refreshable { await reload() }
        }
        .crowScreen()
        .navigationTitle("Claims")
        // Inline like every other screen: as an iPad tab's root it had an empty large-title band.
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { creating = true } label: { Label("New claim", systemImage: "plus") }
                    .accessibilityIdentifier("claims.new")
            }
        }
        .sheet(isPresented: $creating) {
            // Page-sized on an iPad: in the form-sized sheet, Submit sat below the fold. No effect
            // on a phone.
            NewClaimView { Task { await reload() } }
                .presentationSizing(.page)
        }
        .navigationDestination(item: $opened) { id in
            ClaimDetailView(id: id) { Task { await reload() } }
        }
        .onChange(of: model.pendingTarget, initial: true) { _, target in
            guard let target, target.tab == .claims else { return }
            model.pendingTarget = nil
            if case .claim(let id) = target { opened = id }
        }
    }

    private func load() async throws -> [ClaimSummary] {
        try await (session.api.get("/api/v1/claims", query: [URLQueryItem(name: "mine", value: "true"), URLQueryItem(name: "pageSize", value: "50"), URLQueryItem(name: "sort", value: "-createdAt")]) as ClaimPage).items
    }

    private func reload() async {
        do { state = .loaded(try await load()) } catch { state.fail(error) }
    }
}

struct ClaimRow: View {
    let claim: ClaimSummary
    var body: some View {
        let (label, tone) = claim.statusLabel
        AdaptiveRow {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(CrowFont.body(.body, weight: .medium)).fixedSize(horizontal: false, vertical: true)
                    .multilineTextAlignment(.leading)
                Text(details)
                    .font(CrowFont.mono(.caption)).foregroundStyle(Crow.muted).fixedSize(horizontal: false, vertical: true)
            }
        } trailing: {
            VStack(alignment: .leading, spacing: 4) {
                AmountText(cents: claim.totalCents, weight: .semibold)
                StatusChip(text: label, tone: tone)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel([title, details, Fmt.moneySpoken(cents: claim.totalCents), label].filter { !$0.isEmpty }.joined(separator: ", "))
    }

    private var title: String { claim.title ?? claim.typeNames.joined(separator: ", ") }
    private var details: String { [claim.claimNumber, claim.expenseFrom.map(Fmt.dayString)].compactMap { $0 }.joined(separator: " · ") }
}

// MARK: - New claim

/// One expense of a new claim, as typed: text stays as typed, numbers are derived (the web form's
/// `FormLine`). A foreign amount needs the rate, SGD per 1 unit, from the card statement.
struct ClaimLineDraft: Identifiable, Equatable {
    let id = UUID()
    var typeID: String
    var date: Date
    var merchant = ""
    var detail = ""
    var currency = "SGD"
    var amount = ""
    var rate = ""
    var receipt: CapturedImage?

    var isForeign: Bool { currency != "SGD" }
    var exponent: Int { ClaimMoney.exponent(of: currency) }
    var amountMinor: Int? { ClaimMoney.parseMinor(amount, exponent: exponent) }
    /// The amount in SGD cents (the foreign amount at the rate, rounded half-up), or nil while
    /// the amount or rate is incomplete.
    var sgdCents: Int? { ClaimMoney.previewSgd(currency: currency, amountMinor: amountMinor, rate: rate.isEmpty ? nil : rate) }

    /// The web form's messages, shown once something is typed.
    var amountError: String? {
        guard !amount.trimmingCharacters(in: .whitespaces).isEmpty, amountMinor == nil else { return nil }
        return exponent == 0 ? "Enter a whole amount, e.g. 5000." : "Enter the amount, e.g. 45.60."
    }

    var rateError: String? {
        guard isForeign, !rate.trimmingCharacters(in: .whitespaces).isEmpty, ClaimMoney.parseRateMicros(rate) == nil else { return nil }
        return "Enter SGD per 1 \(currency), up to 6 decimal places."
    }

    /// The claim type's receipt rule, on the amount in SGD (as the server applies it).
    func receiptRequired(_ type: ClaimType?) -> Bool { type?.receiptRequired(sgdCents: sgdCents) ?? false }

    /// What is still missing before the line can be sent, in words.
    func missing(_ type: ClaimType?) -> [String] {
        var out: [String] = []
        if type == nil { out.append("the claim type") }
        if merchant.trimmingCharacters(in: .whitespaces).isEmpty { out.append("the merchant") }
        if detail.trimmingCharacters(in: .whitespaces).isEmpty { out.append("what it was for") }
        if amountMinor == nil { out.append("the amount") }
        if isForeign && ClaimMoney.parseRateMicros(rate) == nil { out.append("the rate") }
        if receiptRequired(type) && receipt == nil { out.append("a photo of the receipt") }
        return out
    }

    /// The line to send, once complete.
    func line(receiptIDs: [String]) -> NewClaim.Line? {
        guard let amountMinor else { return nil }
        return NewClaim.Line(claimTypeId: typeID, expenseDate: Fmt.day(date), merchant: merchant.trimmingCharacters(in: .whitespaces),
                             description: detail.trimmingCharacters(in: .whitespaces), currency: currency, amountMinor: amountMinor,
                             rate: isForeign ? rate.trimmingCharacters(in: .whitespaces) : nil, receiptIds: receiptIDs)
    }
}

enum ClaimForm {
    /// The server takes 1 to 30 lines a claim.
    static let maxLines = 30

    /// "To submit, add the merchant and the amount." for one expense; with several, which
    /// expense needs what. Nil when every expense is complete.
    static func missingHint(_ lines: [ClaimLineDraft], types: [ClaimType]) -> String? {
        let parts: [String] = lines.enumerated().compactMap { i, l in
            let m = l.missing(types.first { $0.id == l.typeID })
            guard !m.isEmpty else { return nil }
            return lines.count == 1 ? list(m) : "\(list(m)) to expense \(i + 1)"
        }
        guard let last = parts.last else { return nil }
        return "To submit, add " + (parts.count == 1 ? last : parts.dropLast().joined(separator: ", ") + ", and " + last) + "."
    }

    /// The claim's total in SGD cents: the sum of the lines' rounded SGD amounts.
    static func total(_ lines: [ClaimLineDraft]) -> Int { lines.reduce(0) { $0 + ($1.sgdCents ?? 0) } }

    static func list(_ items: [String]) -> String {
        items.count == 1 ? items[0] : items.dropLast().joined(separator: ", ") + " and " + items.last!
    }

    /// Element identifiers: the first expense keeps the plain names (`claim.amount`), later ones
    /// are numbered (`claim.amount.2`).
    static func identifier(_ base: String, line index: Int) -> String { index == 0 ? base : "\(base).\(index + 1)" }
}

/// A new claim: one or more expenses (up to 30), each with its type, date, merchant, what it was
/// for, amount in any currency (with the rate to SGD and the SGD amount, rounded half-up as the
/// server does) and a camera receipt where the type needs one. Saved as a draft or submitted.
struct NewClaimView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(Session.self) private var session
    @Environment(AppModel.self) private var model
    let onDone: () -> Void

    enum Field: Hashable { case merchant(UUID), detail(UUID), amount(UUID), rate(UUID) }

    @State private var types: LoadState<[ClaimType]> = .loading
    @State private var lines: [ClaimLineDraft] = []
    @State private var cameraFor: UUID?
    @State private var photoFor: UUID?
    @State private var choosingPhoto = false
    @State private var picked: PhotosPickerItem?
    @State private var busy = false
    @State private var error: String?
    /// Receipts already uploaded, by photo: a failed claim (a cap, a closed period, no signal)
    /// sent again reuses them rather than uploading the photos a second time.
    @State private var uploaded: [UUID: String] = [:]
    @FocusState private var focus: Field?

    var body: some View {
        // Derived here, in this view's own body, so the form follows the loaded types and the
        // fields. Read only inside AsyncContent's closure, the state was a stale copy: right after
        // the types loaded the form asked for a claim type while one was shown, and the receipt
        // rule and Submit caught up only once something else changed.
        let typeList = types.value ?? []
        let missing = ClaimForm.missingHint(lines, types: typeList)
        let canSave = missing == nil && !lines.isEmpty
        let total = ClaimForm.total(lines)
        let sending = busy
        let shownError = error
        NavigationStack {
            AsyncContent(state: $types, load: loadTypes) { list in
                RowsScreen {
                    VStack(alignment: .leading, spacing: 22) {
                        if list.isEmpty {
                            Notice(text: "No claim types are set up for you yet. Ask HR to add them in Settings → Claim types.", tone: .neutral)
                        }
                        ForEach($lines) { $line in
                            let index = lines.firstIndex { $0.id == line.id } ?? 0
                            ClaimLineEditor(line: $line, index: index, count: lines.count, types: list, focus: $focus,
                                            onRemove: { remove(line.id) }, onCamera: { cameraFor = line.id },
                                            onPhoto: { photoFor = line.id; choosingPhoto = true })
                        }
                        if lines.count < ClaimForm.maxLines {
                            Button { addLine(types: list) } label: { Label("Add another expense", systemImage: "plus") }
                                .buttonStyle(.crowSecondary)
                                .accessibilityIdentifier("claim.addLine")
                        }
                        AdaptiveRow {
                            SectionLabel("Total")
                        } trailing: {
                            AmountText(cents: total, style: .title3, weight: .semibold)
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel("Total, \(Fmt.moneySpoken(cents: total))")
                        .accessibilityIdentifier("claim.total")
                        if let error = shownError {
                            Notice(text: error, tone: .danger, systemImage: "exclamationmark.triangle")
                                .accessibilityIdentifier("claim.error")
                        }
                        // The buttons stay disabled until the claim is complete: say what is missing.
                        if let missing {
                            Text(missing)
                                .font(CrowFont.body(.footnote)).foregroundStyle(Crow.muted)
                                .fixedSize(horizontal: false, vertical: true)
                                .accessibilityIdentifier("claim.missing")
                        }
                        VStack(spacing: 12) {
                            Button { Task { await save(submit: true) } } label: { Text(sending ? "Sending…" : "Submit claim") }
                                .buttonStyle(.crowPrimary)
                                .disabled(!canSave || sending)
                                .accessibilityIdentifier("claim.submit")
                            // Saves a draft. Not "Save as draft": Azeret Mono draws "ft" as one
                            // ligature glyph, which Xcode's audit reports as clipped text (task 3.7).
                            Button("Save for later") { Task { await save(submit: false) } }
                                .buttonStyle(.crowSecondary)
                                .disabled(!canSave || sending)
                                // The secondary style has no disabled look of its own.
                                .opacity(canSave && !sending ? 1 : 0.5)
                                .accessibilityIdentifier("claim.draft")
                        }
                        .padding(.top, 4)
                    }
                    .padding(16)
                }
            }
            // The background only: `RowsScreen` sets the readable column itself. A second column
            // around it here never settled on an iPad when the text size changed with the claim
            // type's list open: its measured width kept growing, so Xcode's audit timed out.
            .background(Crow.background.ignoresSafeArea())
            .navigationTitle("New claim")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction) }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") { focus = nil }
                }
            }
            .sheet(isPresented: Binding(get: { cameraFor != nil }, set: { if !$0 { cameraFor = nil } })) {
                CameraCapture(stub: model.env.cameraStub) { image in
                    setReceipt(image, for: cameraFor)
                    cameraFor = nil
                }
            }
            .photosPicker(isPresented: $choosingPhoto, selection: $picked, matching: .images)
            .onChange(of: picked) { _, item in
                guard let item else { return }
                // The expense the picker was opened for (set before it opened, kept after).
                let target = photoFor
                Task {
                    if let data = try? await item.loadTransferable(type: Data.self), let image = await CapturedImage.make(data: data) {
                        setReceipt(image, for: target)
                    }
                    picked = nil
                }
            }
        }
    }

    private func setReceipt(_ image: CapturedImage, for id: UUID?) {
        guard let i = lines.firstIndex(where: { $0.id == id }) else { return }
        lines[i].receipt = image
    }

    private func addLine(types: [ClaimType]) {
        // A new expense starts on the previous one's date, as on the web.
        lines.append(ClaimLineDraft(typeID: types.first?.id ?? "", date: lines.last?.date ?? Date()))
    }

    private func remove(_ id: UUID) {
        guard lines.count > 1 else { return }
        lines.removeAll { $0.id == id }
    }

    private func loadTypes() async throws -> [ClaimType] {
        let list: ClaimTypeList = try await session.api.get("/api/v1/claims/eligible-types", query: [URLQueryItem(name: "date", value: Fmt.day(Date()))])
        if lines.isEmpty {
            lines = [ClaimLineDraft(typeID: list.items.first?.id ?? "", date: Date())]
        } else {
            for i in lines.indices where lines[i].typeID.isEmpty { lines[i].typeID = list.items.first?.id ?? "" }
        }
        return list.items
    }

    private func save(submit: Bool) async {
        guard ClaimForm.missingHint(lines, types: types.value ?? []) == nil else { return }
        busy = true
        defer { busy = false }
        error = nil
        do {
            var out: [NewClaim.Line] = []
            for l in lines {
                var receiptIDs: [String] = []
                if let receipt = l.receipt {
                    if let id = uploaded[receipt.id] {
                        receiptIDs.append(id)
                    } else if let jpeg = receipt.jpeg {
                        let (data, _) = try await session.api.raw("POST", "/api/v1/claims/receipts", query: [URLQueryItem(name: "fileName", value: "receipt.jpg")], body: jpeg, contentType: "image/jpeg")
                        guard let id = try? JSONDecoder().decode(ReceiptUpload.self, from: data).id else { throw APIError.unreadable }
                        uploaded[receipt.id] = id
                        receiptIDs.append(id)
                    }
                }
                guard let line = l.line(receiptIDs: receiptIDs) else { return }
                out.append(line)
            }
            // Not decoded: once the server accepted it the claim exists, and an error here would
            // invite claiming twice.
            try await session.api.postNoContent("/api/v1/claims", json: NewClaim(title: nil, lines: out, submit: submit))
            onDone()
            dismiss()
        } catch {
            self.error = APIError.from(error, host: "").message
        }
    }
}

/// One expense in New claim. A foreign currency adds the rate (SGD per 1 unit) and shows the
/// amount in SGD, as the web form does.
private struct ClaimLineEditor: View {
    @Binding var line: ClaimLineDraft
    let index: Int
    let count: Int
    let types: [ClaimType]
    var focus: FocusState<NewClaimView.Field?>.Binding
    let onRemove: () -> Void
    let onCamera: () -> Void
    let onPhoto: () -> Void
    @Environment(\.dynamicTypeSize) private var typeSize
    /// Room for "MYR" and the menu's chevron, growing with the text size.
    @ScaledMetric(relativeTo: .body) private var currencyWidth: CGFloat = 112

    private func id(_ base: String) -> String { ClaimForm.identifier(base, line: index) }

    var body: some View {
        let type = types.first { $0.id == line.typeID }
        let needsReceipt = line.receiptRequired(type)
        VStack(alignment: .leading, spacing: 18) {
            if count > 1 {
                AdaptiveRow {
                    SectionLabel("Expense \(index + 1)")
                } trailing: {
                    Button("Remove", role: .destructive, action: onRemove)
                        .buttonStyle(.crowCompactDanger)
                        .accessibilityLabel("Remove expense \(index + 1)")
                        .accessibilityIdentifier(id("claim.removeLine"))
                }
            }
            ChoiceRow(title: "Type", options: types.map { (id: $0.id, name: $0.name) }, selection: $line.typeID, identifier: id("claim.type"))
            FormField("Date") {
                DatePicker("Date", selection: $line.date, in: ...Date(), displayedComponents: .date)
                    .labelsHidden()
                    .singaporeDates()
                    .accessibilityIdentifier(id("claim.date"))
            }
            FormField("Merchant") {
                // A business name: no autocorrect (or spell-check marks) on names like "Kopi Kaki".
                // Placeholders stay on one line even in a wrapping field: keep them short.
                TextField("Merchant", text: $line.merchant, prompt: Text("Who you paid"), axis: .vertical)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.words)
                    .submitLabel(.next)
                    .returnEndsField($line.merchant) { focus.wrappedValue = .detail(line.id) }
                    .focused(focus, equals: .merchant(line.id))
                    .font(CrowFont.body())
                    .accessibilityIdentifier(id("claim.merchant"))
                    .crowFieldBox(focused: focus.wrappedValue == .merchant(line.id))
            }
            FormField("What was it for?") {
                // Return closes the keyboard (the amount pad has no return key of its own).
                TextField("What was it for?", text: $line.detail, prompt: Text("Team lunch"), axis: .vertical)
                    .submitLabel(.done)
                    .returnEndsField($line.detail) { focus.wrappedValue = nil }
                    .focused(focus, equals: .detail(line.id))
                    .font(CrowFont.body())
                    .accessibilityIdentifier(id("claim.description"))
                    .crowFieldBox(focused: focus.wrappedValue == .detail(line.id))
            }
            // The currency beside the amount, as on the web; stacked at accessibility sizes. One
            // `AnyLayout` for both, so a text-size change (Xcode's audit makes one) keeps the
            // fields' identity and the currency list's navigation destination.
            let large = typeSize.isAccessibilitySize
            let pair = large ? AnyLayout(VStackLayout(alignment: .leading, spacing: 18)) : AnyLayout(HStackLayout(alignment: .top, spacing: 12))
            pair {
                currencyField.frame(width: large ? nil : currencyWidth)
                amountField
            }
            if line.isForeign { rateField }
            receiptField(needsReceipt: needsReceipt, hint: type?.receiptHint)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(id("claim.line"))
    }

    /// The currency: its code in the field, the code and name in the list.
    private var currencyField: some View {
        ChoiceRow(title: "Currency", options: ClaimMoney.currencies.map { (id: $0.code, name: "\($0.code) · \($0.label)") },
                  selection: Binding(get: { line.currency }, set: { code in
                      line.currency = code
                      if code == "SGD" { line.rate = "" }
                  }), identifier: id("claim.currency"), shown: { $0 })
    }

    private var amountField: some View {
        FormField("Amount") {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(line.isForeign ? line.currency : "S$").font(CrowFont.mono(.body)).foregroundStyle(Crow.muted)
                        .accessibilityHidden(true)
                    TextField(line.isForeign ? "Amount in \(line.currency)" : "Amount in Singapore dollars", text: $line.amount,
                              prompt: Text(line.exponent == 0 ? "5000" : "0.00"))
                        .keyboardType(line.exponent == 0 ? .numberPad : .decimalPad)
                        .font(CrowFont.mono(.body))
                        .focused(focus, equals: .amount(line.id))
                        .accessibilityIdentifier(id("claim.amount"))
                }
                .crowFieldBox(focused: focus.wrappedValue == .amount(line.id), invalid: line.amountError != nil)
                if let e = line.amountError {
                    Text(e).font(CrowFont.body(.footnote)).foregroundStyle(Crow.danger)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier(id("claim.amountError"))
                }
        }
    }

    /// "Rate: SGD per 1 MYR", then "= S$37.80" as typed, as on the web.
    private var rateField: some View {
        FormField("Rate: SGD per 1 \(line.currency)") {
            TextField("Rate, Singapore dollars per 1 \(line.currency)", text: $line.rate, prompt: Text("0.301234"))
                .keyboardType(.decimalPad)
                .font(CrowFont.mono(.body))
                .focused(focus, equals: .rate(line.id))
                .accessibilityIdentifier(id("claim.rate"))
                .crowFieldBox(focused: focus.wrappedValue == .rate(line.id), invalid: line.rateError != nil)
            if let e = line.rateError {
                Text(e).font(CrowFont.body(.footnote)).foregroundStyle(Crow.danger)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier(id("claim.rateError"))
            }
            let sgd = line.sgdCents
            Text("= \(sgd.map { Fmt.money(cents: $0) } ?? "S$—")")
                .font(CrowFont.mono(.body, weight: .semibold))
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityLabel(sgd.map { "Equals \(Fmt.moneySpoken(cents: $0))" } ?? "Amount in Singapore dollars not worked out yet")
                .accessibilityIdentifier(id("claim.sgdPreview"))
            Text("Use the rate on your card statement. Rounded half-up to the cent.")
                .font(CrowFont.body(.footnote)).foregroundStyle(Crow.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func receiptField(needsReceipt: Bool, hint: String?) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(needsReceipt ? "Receipt (required)" : "Receipt")
            if let receipt = line.receipt {
                HStack(spacing: 12) {
                    Image(uiImage: receipt.image).resizable().scaledToFit().frame(height: 80)
                        .accessibilityLabel("Receipt photo").accessibilityIdentifier(id("claim.receiptPreview"))
                    Spacer()
                    Button("Remove", role: .destructive) { line.receipt = nil }
                        .buttonStyle(.crowCompactDanger)
                        .accessibilityLabel(count > 1 ? "Remove the receipt of expense \(index + 1)" : "Remove the receipt")
                }
            } else {
                Button(action: onCamera) { Label("Photograph receipt", systemImage: "camera") }
                    .buttonStyle(.crowSecondary)
                    .accessibilityIdentifier(id("claim.camera"))
                Button(action: onPhoto) { Label("Choose a photo", systemImage: "photo") }
                    .buttonStyle(.crowSecondary)
            }
            if let hint, !hint.isEmpty {
                Text(hint).font(CrowFont.body(.footnote)).foregroundStyle(Crow.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}
