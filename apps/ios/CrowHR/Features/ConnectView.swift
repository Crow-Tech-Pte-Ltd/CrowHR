import SwiftUI

struct PendingConnection: Identifiable {
    let id = UUID()
    let server: ServerAddress
    let meta: ServerMeta
    let organisation: ServerMeta.Organisation
}

/// First launch: enter the server address or scan the QR code from the web app.
struct ConnectView: View {
    @Environment(AppModel.self) private var model
    @State private var address = ""
    @State private var org = ""
    @State private var needsOrg = false
    @State private var checking = false
    @State private var error: String?
    @State private var pending: PendingConnection?
    @State private var scanning = false
    @State private var viewport: CGFloat = 0
    @FocusState private var focused: Bool
    @FocusState private var orgFocused: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 12) {
                    CrowMark()
                    Text("Connect to your company")
                        .font(CrowFont.mono(.title2, weight: .semibold))
                        .accessibilityAddTraits(.isHeader)
                    Text("Crow HR runs on your company's own server. Enter its address, or scan the QR code in Crow HR on the web under My profile → Mobile app.")
                        .font(CrowFont.body(.subheadline))
                        .foregroundStyle(Crow.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }

                VStack(alignment: .leading, spacing: 6) {
                    SectionLabel("Server address")
                    // Wraps rather than clipping a long address at large text sizes; Return continues.
                    // The placeholder stays on one line, so it is short enough for the largest size.
                    TextField("hr.acme.sg", text: $address, axis: .vertical)
                        .textContentType(.URL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.go)
                        .focused($focused)
                        .returnEndsField($address) { Task { await check() } }
                        .font(CrowFont.mono(.body))
                        .crowFieldBox(focused: focused)
                        .accessibilityLabel("Server address")
                        .accessibilityIdentifier("connect.address")
                }

                if needsOrg {
                    VStack(alignment: .leading, spacing: 6) {
                        SectionLabel("Organisation ID")
                        TextField("your-org", text: $org, axis: .vertical)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .submitLabel(.go)
                            .returnEndsField($org) { Task { await check() } }
                            .focused($orgFocused)
                            .font(CrowFont.mono(.body))
                            // The same focus ring as the address (it had none).
                            .crowFieldBox(focused: orgFocused)
                            .accessibilityLabel("Organisation ID")
                            .accessibilityIdentifier("connect.org")
                        Text("This server hosts several organisations. Enter your organisation's ID from HR, or scan the QR code.")
                            .font(CrowFont.body(.footnote)).foregroundStyle(Crow.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                if let error = error ?? model.linkError {
                    Notice(text: error, tone: .danger, systemImage: "exclamationmark.triangle")
                        .accessibilityIdentifier("connect.error")
                }

                VStack(spacing: 12) {
                    Button {
                        Task { await check() }
                    } label: {
                        if checking { ProgressView().tint(Crow.onKuning) } else { Text("Continue") }
                    }
                    .buttonStyle(.crowPrimary)
                    .disabled(checking || address.trimmingCharacters(in: .whitespaces).isEmpty)
                    .accessibilityIdentifier("connect.continue")

                    Button {
                        scanning = true
                    } label: {
                        Label("Scan QR code", systemImage: "qrcode.viewfinder")
                    }
                    .buttonStyle(.crowSecondary)
                    .accessibilityIdentifier("connect.scan")
                }

                if !model.connections.isEmpty {
                    SavedConnectionsSection()
                }
            }
            .padding(20)
            .crowCentredForm(viewport: viewport)
        }
        .onScrollGeometryChange(for: CGFloat.self) { $0.containerSize.height - $0.contentInsets.top - $0.contentInsets.bottom } action: { viewport = $1 }
        .crowScreen(maxWidth: CrowLayout.formWidth)
        .navigationTitle("Crow HR")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if model.active != nil {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { model.cancelAddConnection() }
                }
            }
        }
        .sheet(item: $pending) { p in
            ConfirmServerView(pending: p)
        }
        .sheet(isPresented: $scanning) {
            QRScannerSheet { result in
                scanning = false
                switch result {
                case .success(let link): model.pendingLink = link
                case .failure(let failure): error = failure.message
                }
            }
        }
        .task(id: model.pendingLink) {
            guard let link = model.pendingLink else { return }
            address = link.server
            org = link.org ?? ""
            needsOrg = link.org != nil
            await check()
        }
    }

    private func check() async {
        error = nil
        model.linkError = nil
        let server: ServerAddress
        do throws(ServerAddressError) { server = try ServerAddress.parse(address) } catch {
            self.error = error.message
            return
        }
        let orgSlug = org.trimmingCharacters(in: .whitespaces).lowercased()
        if needsOrg && !orgSlug.isEmpty && !OrgSlug.isValid(orgSlug) {
            self.error = ConnectMessages.orgNotFound
            return
        }
        checking = true
        defer { checking = false }
        let result = await model.check(server: server, org: orgSlug.isEmpty ? nil : orgSlug)
        switch result {
        case .compatible(let meta, let organisation):
            pending = PendingConnection(server: server, meta: meta, organisation: organisation)
        case .organisationRequired:
            needsOrg = true
            error = result.message
        default:
            error = result.message
        }
    }
}

/// Shows the organisation and asks the user to confirm before saving the connection.
struct ConfirmServerView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let pending: PendingConnection
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HStack(spacing: 14) {
                        ServerLogo(server: pending.server, logoUrl: pending.organisation.logoUrl)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(pending.organisation.displayName)
                                .font(CrowFont.mono(.title3, weight: .semibold))
                                .fixedSize(horizontal: false, vertical: true)
                                .accessibilityIdentifier("confirm.orgName")
                            ServerText(server: pending.server)
                        }
                    }
                    if pending.server.isInsecure {
                        Notice(text: ConnectMessages.insecureWarning, tone: .warning, systemImage: "lock.open")
                            .accessibilityIdentifier("confirm.insecure")
                    }
                    if pending.meta.demo {
                        Notice(text: "This is a demo server with fictional data.", tone: .neutral)
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        SectionLabel("Sign in with")
                        ForEach(pending.organisation.signInMethods, id: \.kind) { m in
                            Text(m.displayName).font(CrowFont.body())
                        }
                    }
                    Text("Is this your company? Crow HR will only ever talk to this server.")
                        .font(CrowFont.body(.subheadline)).foregroundStyle(Crow.muted)
                        .fixedSize(horizontal: false, vertical: true)
                    if let error { Notice(text: error, tone: .danger, systemImage: "exclamationmark.triangle") }
                    Button("Connect") {
                        do throws(ConnectionStoreError) {
                            try model.connect(server: pending.server, organisation: pending.organisation, meta: pending.meta)
                            dismiss()
                        } catch {
                            self.error = error.message
                        }
                    }
                    .buttonStyle(.crowPrimary)
                    .accessibilityIdentifier("confirm.connect")
                }
                .padding(20)
            }
            .crowScreen()
            .navigationTitle("Confirm")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction) } }
        }
        // Full height (no medium detent): at a medium detent Xcode's audit reported most of this
        // sheet's text as clipped (task 3.7), and at large text sizes half a screen showed little.
        // On an iPad, a form-sized sheet.
        .presentationSizing(.form)
    }
}

/// The server's address, in mono. VoiceOver says "Server" first: a bare URL is not a readable label.
struct ServerText: View {
    let server: ServerAddress

    var body: some View {
        Text(server.display)
            .font(CrowFont.mono(.footnote))
            .foregroundStyle(Crow.muted)
            // A label that differs from the text audits clean only on text that grows vertically.
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityLabel("Server \(server.display)")
    }
}

/// The organisation's logo, fetched through the app's own transport and only from the same
/// server: a logo hosted elsewhere is not loaded (network allow-list).
struct ServerLogo: View {
    @Environment(AppModel.self) private var model
    let server: ServerAddress
    let logoUrl: String?
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().scaledToFit()
                    .accessibilityLabel("Organisation logo")
                    .accessibilityIdentifier("org.logo")
            } else {
                CrowMark(size: 48)
            }
        }
        .frame(width: 48, height: 48)
        .task {
            guard let raw = logoUrl, let url = URL(string: raw, relativeTo: server.url)?.absoluteURL, server.isSameOrigin(url) else { return }
            if let (data, res) = try? await model.env.transport.send(URLRequest(url: url)), res.statusCode == 200 {
                image = UIImage(data: data)
            }
        }
    }
}

struct SavedConnectionsSection: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel("Saved connections")
            ForEach(model.connections) { c in
                Button {
                    model.switchTo(c)
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(c.orgName).font(CrowFont.body(.body, weight: .medium)).foregroundStyle(Crow.ink)
                            Text(c.server.display).font(CrowFont.mono(.caption)).foregroundStyle(Crow.muted)
                        }
                        Spacer()
                        if c.id == model.active?.id { StatusChip(text: "Current", tone: .accent) }
                    }
                    .padding(12)
                    .overlay(RoundedRectangle(cornerRadius: Crow.radius).strokeBorder(Crow.hairline, lineWidth: 1))
                }
                .accessibilityLabel("\(c.orgName), \(c.server.display)\(c.id == model.active?.id ? ", current" : "")")
            }
            Text("Up to \(ConnectionStore.maxConnections) connections.").font(CrowFont.body(.footnote)).foregroundStyle(Crow.muted)
        }
    }
}

struct SignInView: View {
    @Environment(AppModel.self) private var model
    @State private var busy = false
    @State private var error: String?
    @State private var authenticator = SystemWebAuthenticator()
    @State private var viewport: CGFloat = 0

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let c = model.active {
                    VStack(alignment: .leading, spacing: 8) {
                        ServerLogo(server: c.server, logoUrl: c.logoUrl)
                        Text(c.orgName).font(CrowFont.mono(.title2, weight: .semibold)).accessibilityIdentifier("signin.orgName")
                        ServerText(server: c.server)
                    }
                    if let message = model.signedOutMessage {
                        Notice(text: message, tone: .warning, systemImage: "person.crop.circle.badge.exclamationmark")
                            .accessibilityIdentifier("signin.signedOut")
                    }
                    if c.server.isInsecure {
                        Notice(text: ConnectMessages.insecureWarning, tone: .warning, systemImage: "lock.open")
                    }
                    Text("Your company's sign-in page opens in a secure browser window. Use the method your company has set up. The app never sees your password.")
                        .font(CrowFont.body(.subheadline)).foregroundStyle(Crow.muted)
                        .fixedSize(horizontal: false, vertical: true)
                    if let error { Notice(text: error, tone: .danger, systemImage: "exclamationmark.triangle").accessibilityIdentifier("signin.error") }
                    Button {
                        Task { await signIn() }
                    } label: {
                        if busy { ProgressView().tint(Crow.onKuning) } else { Text("Sign in") }
                    }
                    .buttonStyle(.crowPrimary)
                    .disabled(busy)
                    .accessibilityIdentifier("signin.start")

                    // Not "different": Azeret Mono's "ff" ligature reads as clipped text to Xcode's audit.
                    Button("Use another server") { model.addConnection() }
                        .buttonStyle(.crowSecondary)
                        .accessibilityIdentifier("signin.otherServer")
                    if model.connections.count > 1 { SavedConnectionsSection() }
                }
            }
            .padding(20)
            .crowCentredForm(viewport: viewport)
        }
        .onScrollGeometryChange(for: CGFloat.self) { $0.containerSize.height - $0.contentInsets.top - $0.contentInsets.bottom } action: { viewport = $1 }
        .crowScreen(maxWidth: CrowLayout.formWidth)
        .navigationTitle("Sign in")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func signIn() async {
        error = nil
        busy = true
        defer { busy = false }
        do {
            try await model.signIn(with: authenticator)
        } catch NativeAuthError.cancelled {
            // The user closed the browser: nothing to report.
        } catch let e as NativeAuthError {
            error = e.message
        } catch let e as APIError {
            error = e.message
        } catch {
            self.error = "Sign-in didn't finish. Check your connection and try again."
        }
    }
}
