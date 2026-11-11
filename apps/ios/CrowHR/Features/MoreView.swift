import SwiftUI

/// The tab bar's More: the screens the iPad sidebar lists itself. Links push `MainTab` values on
/// `AppModel.morePath`, so a screen chosen in the sidebar can move here when the iPad's window
/// loses the sidebar (and back).
struct MoreView: View {
    @Environment(Session.self) private var session

    var body: some View {
        RowsScreen {
            RowGroup {
                if session.isAvailable(.claims) {
                    NavigationLink(value: MainTab.claims) { MoreRow(title: "Claims", systemImage: "receipt") }
                        .buttonStyle(.crowNavigationRow)
                        .accessibilityIdentifier("more.claims")
                }
                if session.isAvailable(.schedule) {
                    NavigationLink(value: MainTab.schedule) { MoreRow(title: "My schedule", systemImage: "calendar.day.timeline.left") }
                        .buttonStyle(.crowNavigationRow)
                        .accessibilityIdentifier("more.schedule")
                }
                NavigationLink(value: MainTab.profile) { MoreRow(title: "My profile", systemImage: "person") }
                    .buttonStyle(.crowNavigationRow)
                    .accessibilityIdentifier("more.profile")
                NavigationLink(value: MainTab.settings) { MoreRow(title: "Settings", systemImage: "gearshape") }
                    .buttonStyle(.crowNavigationRow)
                    .accessibilityIdentifier("more.settings")
            }
        }
        .navigationTitle("More")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: MainTab.self) { tab in
            switch tab {
            case .claims: ClaimsView()
            case .schedule: ScheduleView()
            case .profile: ProfileView()
            default: SettingsView()
            }
        }
    }
}

/// An icon and a title; VoiceOver reads the title.
private struct MoreRow: View {
    let title: String
    let systemImage: String

    var body: some View {
        Label {
            Text(title).font(CrowFont.body()).foregroundStyle(Crow.ink).fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: systemImage).foregroundStyle(Crow.ink)
        }
    }
}

/// Read-only profile. Identity numbers arrive already masked from the server.
struct ProfileView: View {
    @Environment(Session.self) private var session
    @State private var state: LoadState<MyProfile> = .loading

    var body: some View {
        AsyncContent(state: $state, load: { try await session.api.get("/api/v1/people/me/profile") }) { p in
            RowsScreen {
                RowGroup {
                    InfoRow("Name", p.employee.name)
                    InfoRow("Employee no.", p.employee.employeeNumber, mono: true)
                    if let e = p.employee.workEmail { InfoRow("Work email", e) }
                }
                if let job = p.employee.job {
                    RowGroup(header: "Job") {
                        InfoRow("Job title", job.jobTitle)
                        if let d = job.department { InfoRow("Department", d.name) }
                        if let l = job.location { InfoRow("Location", l.name) }
                        if let m = job.manager { InfoRow("Manager", m.name) }
                    }
                }
                if let personal = p.employee.personal {
                    RowGroup(header: "Personal", footer: "To change your details, use My profile in Crow HR on the web.") {
                        InfoRow(personal.idType.uppercased(), personal.idNumberMasked, mono: true)
                        if let m = personal.mobile { InfoRow("Mobile", m, mono: true) }
                        if let e = personal.personalEmail { InfoRow("Personal email", e) }
                    }
                }
            }
        }
        .crowScreen()
        .navigationTitle("My profile")
    }
}

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(Session.self) private var session
    @State private var confirmSignOut = false
    @State private var confirmRemove: SavedConnection?
    @State private var origins: [String] = []

    var body: some View {
        @Bindable var model = model
        let unsent = session.punches.filter(\.isPending).count
        RowsScreen {
            RowGroup(header: "Connection") {
                InfoRow("Organisation", session.connection.orgName)
                InfoRow("Server", session.connection.server.display, mono: true)
                if let me = session.me {
                    InfoRow("Signed in as", me.user.displayName)
                }
                if session.connection.server.isInsecure {
                    Text("This connection is not encrypted (http).")
                        .font(CrowFont.body()).foregroundStyle(Crow.warning)
                        .fixedSize(horizontal: false, vertical: true)
                        .crowRowPadding()
                }
                Button(role: .destructive) { confirmSignOut = true } label: {
                    Text("Sign out").font(CrowFont.body()).foregroundStyle(Crow.danger)
                }
                .buttonStyle(.crowRow)
                .accessibilityIdentifier("settings.signOut")
            }

            RowGroup(header: "Saved connections", footer: "Up to \(ConnectionStore.maxConnections).") {
                ForEach(model.connections) { c in
                    let current = c.id == session.connection.id
                    VStack(alignment: .leading, spacing: 0) {
                        Button {
                            if !current { model.switchTo(c) }
                        } label: {
                            AdaptiveRow {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(c.orgName).font(CrowFont.body()).foregroundStyle(Crow.ink)
                                        .fixedSize(horizontal: false, vertical: true)
                                    Text(c.server.display).font(CrowFont.mono(.caption)).foregroundStyle(Crow.muted)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            } trailing: {
                                if current { StatusChip(text: "Current", tone: .accent) }
                            }
                        }
                        .buttonStyle(.crowRow)
                        .accessibilityHint(current ? "" : "Switches to this connection")
                        // Was a swipe action in a List: now a visible button, which also asks first.
                        Button("Remove", role: .destructive) { confirmRemove = c }
                            .buttonStyle(.crowCompactDanger)
                            .accessibilityLabel("Remove \(c.orgName)")
                            .padding(.horizontal, 16)
                            .padding(.bottom, 12)
                    }
                }
                if model.connections.count < ConnectionStore.maxConnections {
                    Button { model.addConnection() } label: {
                        Text("Add a connection").font(CrowFont.body()).foregroundStyle(Crow.ink)
                    }
                    .buttonStyle(.crowNavigationRow)
                }
            }

            RowGroup(header: "Security and notifications", footer: "The app asks again after 5 minutes in the background. Notifications only say how many new items you have; open the app to see them.") {
                Toggle(isOn: $model.biometricEnabled) {
                    // Face ID on iPhones and iPad Pro, Touch ID on other iPads.
                    Text(model.biometryName.map { "Unlock with \($0) or passcode" } ?? "Unlock with passcode")
                        .font(CrowFont.body()).fixedSize(horizontal: false, vertical: true)
                }
                .disabled(!model.biometryAvailable && !model.biometricEnabled)
                .crowRowPadding()
                .accessibilityIdentifier("settings.biometric")
                Toggle(isOn: Binding(get: { model.notificationsEnabled }, set: { on in Task { await model.setNotifications(on) } })) {
                    Text("Notify me about new items").font(CrowFont.body()).fixedSize(horizontal: false, vertical: true)
                }
                .crowRowPadding()
                .accessibilityIdentifier("settings.notifications")
            }

            let unavailable = FeatureGate.unavailableMessages(serverFeatures: session.connection.features)
            if !unavailable.isEmpty {
                RowGroup(header: "Not available") {
                    ForEach(unavailable, id: \.self) {
                        Text($0).font(CrowFont.body(.footnote)).fixedSize(horizontal: false, vertical: true).crowRowPadding()
                    }
                }
            }

            RowGroup(header: "Privacy") {
                Text("Crow HR only talks to \(session.connection.server.display). Crow Tech collects no data: no analytics, no crash reports, no tracking.")
                    .font(CrowFont.body(.footnote))
                    .fixedSize(horizontal: false, vertical: true)
                    .crowRowPadding()
                if model.env.isUITest {
                    // UI tests read this to assert the network allow-list.
                    Text(origins.joined(separator: " "))
                        .font(CrowFont.mono(.caption2))
                        .fixedSize(horizontal: false, vertical: true)
                        .crowRowPadding()
                        .accessibilityIdentifier("debug.networkOrigins")
                        .task { origins = await model.env.recorder?.distinctOrigins() ?? [] }
                }
            }

            RowGroup(header: "About") {
                InfoRow("Version", AppModel.appVersion, mono: true)
                NavigationLink { LicencesView() } label: {
                    Text("Font licences").font(CrowFont.body()).foregroundStyle(Crow.ink)
                }
                .buttonStyle(.crowNavigationRow)
                Link(destination: URL(string: "https://github.com/Crow-Tech-Pte-Ltd/CrowHR")!) {
                    Text("Source code (MIT)").font(CrowFont.body()).foregroundStyle(Crow.biru)
                }
                .buttonStyle(RowButtonStyle(accessory: .external))
            }
        }
        .navigationTitle("Settings")
        .confirmationDialog(unsent > 0 ? "\(unsent) punch\(unsent == 1 ? " hasn't" : "es haven't") been sent" : "Sign out?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            if unsent > 0 {
                Button("Sign out and delete unsent punches", role: .destructive) { Task { await model.signOut(discardUnsentPunches: true) } }
                Button("Keep them and sign out") { Task { await model.signOut() } }
            } else {
                Button("Sign out", role: .destructive) { Task { await model.signOut() } }
            }
        } message: {
            Text(unsent > 0 ? "Unsent punches are sent after you sign in again. Deleting them can't be undone." : "This phone is signed out on the server, and its data is removed.")
        }
        .alert("Remove this connection?", isPresented: Binding(get: { confirmRemove != nil }, set: { if !$0 { confirmRemove = nil } }), presenting: confirmRemove) { c in
            Button("Remove", role: .destructive) { Task { await model.remove(c) } }
            Button("Cancel", role: .cancel) {}
        } message: { c in
            Text("\(c.orgName) is removed from this phone, with any punches not yet sent.")
        }
    }
}

struct LicencesView: View {
    var body: some View {
        RowsScreen {
            licence(font: "Azeret Mono", name: "SIL Open Font Licence 1.1", file: "AzeretMono-OFL")
            licence(font: "Ubuntu", name: "Ubuntu Font Licence 1.0", file: "Ubuntu-LICENCE")
        }
        .navigationTitle("Font licences")
    }

    private func licence(font: String, name: String, file: String) -> some View {
        RowGroup(header: font) {
            VStack(alignment: .leading, spacing: 8) {
                Text(name).font(CrowFont.body(.body, weight: .medium)).fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                Text(Self.text(file)).font(.system(.footnote, design: .monospaced))
            }
            .crowRowPadding()
        }
    }

    static func text(_ name: String) -> String {
        guard let url = Bundle.main.url(forResource: name, withExtension: "txt"), let s = try? String(contentsOf: url, encoding: .utf8) else { return "" }
        return s
    }
}
