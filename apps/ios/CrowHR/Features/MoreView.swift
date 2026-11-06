import SwiftUI

struct MoreView: View {
    @Environment(Session.self) private var session

    var body: some View {
        List {
            if session.isAvailable(.claims) {
                NavigationLink { ClaimsView() } label: { Label("Claims", systemImage: "receipt") }
                    .accessibilityIdentifier("more.claims")
            }
            if session.isAvailable(.schedule) {
                NavigationLink { ScheduleView() } label: { Label("My schedule", systemImage: "calendar.day.timeline.left") }
                    .accessibilityIdentifier("more.schedule")
            }
            NavigationLink { ProfileView() } label: { Label("My profile", systemImage: "person") }
                .accessibilityIdentifier("more.profile")
            NavigationLink { SettingsView() } label: { Label("Settings", systemImage: "gearshape") }
                .accessibilityIdentifier("more.settings")
        }
        .font(CrowFont.body())
        .crowScreen()
        .navigationTitle("More")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Read-only profile. Identity numbers arrive already masked from the server.
struct ProfileView: View {
    @Environment(Session.self) private var session
    @State private var state: LoadState<MyProfile> = .loading

    var body: some View {
        AsyncContent(state: $state, load: { try await session.api.get("/api/v1/people/me/profile") }) { p in
            List {
                Section {
                    row("Name", p.employee.name)
                    row("Employee no.", p.employee.employeeNumber, mono: true)
                    if let e = p.employee.workEmail { row("Work email", e) }
                }
                if let job = p.employee.job {
                    Section {
                        row("Job title", job.jobTitle)
                        if let d = job.department { row("Department", d.name) }
                        if let l = job.location { row("Location", l.name) }
                        if let m = job.manager { row("Manager", m.name) }
                    } header: { SectionLabel("Job") }
                }
                if let personal = p.employee.personal {
                    Section {
                        row(personal.idType.uppercased(), personal.idNumberMasked, mono: true)
                        if let m = personal.mobile { row("Mobile", m, mono: true) }
                        if let e = personal.personalEmail { row("Personal email", e) }
                    } header: { SectionLabel("Personal") } footer: {
                        Text("To change your details, use My profile in Crow HR on the web.")
                    }
                }
            }
            .listStyle(.insetGrouped)
        }
        .crowScreen()
        .navigationTitle("My profile")
    }

    private func row(_ label: String, _ value: String, mono: Bool = false) -> some View {
        LabeledContent {
            Text(value).font(mono ? CrowFont.mono(.body) : CrowFont.body()).foregroundStyle(Crow.ink).multilineTextAlignment(.trailing)
        } label: {
            Text(label).font(CrowFont.body(.subheadline)).foregroundStyle(Crow.muted)
        }
        .accessibilityElement(children: .combine)
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
        List {
            Section {
                LabeledContent("Organisation", value: session.connection.orgName)
                LabeledContent("Server") { Text(session.connection.server.display).font(CrowFont.mono(.subheadline)) }
                if let me = session.me {
                    LabeledContent("Signed in as", value: me.user.displayName)
                }
                if session.connection.server.isInsecure {
                    Text("This connection is not encrypted (http).").foregroundStyle(Crow.warning)
                }
                Button("Sign out", role: .destructive) { confirmSignOut = true }
                    .accessibilityIdentifier("settings.signOut")
            } header: { SectionLabel("Connection") }

            Section {
                ForEach(model.connections) { c in
                    Button {
                        if c.id != session.connection.id { model.switchTo(c) }
                    } label: {
                        HStack {
                            VStack(alignment: .leading) {
                                Text(c.orgName).foregroundStyle(Crow.ink)
                                Text(c.server.display).font(CrowFont.mono(.caption)).foregroundStyle(Crow.muted)
                            }
                            Spacer()
                            if c.id == session.connection.id { StatusChip(text: "Current", tone: .accent) }
                        }
                    }
                    .swipeActions { Button("Remove", role: .destructive) { confirmRemove = c } }
                }
                if model.connections.count < ConnectionStore.maxConnections {
                    Button("Add a connection") { model.addConnection() }
                }
            } header: { SectionLabel("Saved connections") } footer: {
                Text("Up to \(ConnectionStore.maxConnections). Swipe to remove one.")
            }

            Section {
                Toggle("Unlock with Face ID or passcode", isOn: $model.biometricEnabled)
                    .disabled(!model.biometryAvailable && !model.biometricEnabled)
                    .accessibilityIdentifier("settings.biometric")
                Toggle("Notify me about new items", isOn: Binding(get: { model.notificationsEnabled }, set: { on in Task { await model.setNotifications(on) } }))
                    .accessibilityIdentifier("settings.notifications")
            } header: { SectionLabel("Security and notifications") } footer: {
                Text("The app asks again after 5 minutes in the background. Notifications only say how many new items you have; open the app to see them.")
            }

            let unavailable = FeatureGate.unavailableMessages(serverFeatures: session.connection.features)
            if !unavailable.isEmpty {
                Section {
                    ForEach(unavailable, id: \.self) { Text($0).font(CrowFont.body(.footnote)) }
                } header: { SectionLabel("Not available") }
            }

            Section {
                Text("Crow HR only talks to \(session.connection.server.display). Crow Tech collects no data: no analytics, no crash reports, no tracking.")
                    .font(CrowFont.body(.footnote))
                if model.env.isUITest {
                    // UI tests read this to assert the network allow-list.
                    Text(origins.joined(separator: " "))
                        .font(CrowFont.mono(.caption2))
                        .accessibilityIdentifier("debug.networkOrigins")
                        .task { origins = await model.env.recorder?.distinctOrigins() ?? [] }
                }
            } header: { SectionLabel("Privacy") }

            Section {
                LabeledContent("Version") { Text(AppModel.appVersion).font(CrowFont.mono(.subheadline)) }
                NavigationLink("Font licences") { LicencesView() }
                Link("Source code (MIT)", destination: URL(string: "https://github.com/Crow-Tech-Pte-Ltd/CrowHR")!)
            } header: { SectionLabel("About") }
        }
        .listStyle(.insetGrouped)
        .crowScreen()
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
        List {
            Section("Azeret Mono — SIL Open Font Licence 1.1") { Text(Self.text("AzeretMono-OFL")).font(.system(.footnote, design: .monospaced)) }
            Section("Ubuntu — Ubuntu Font Licence 1.0") { Text(Self.text("Ubuntu-LICENCE")).font(.system(.footnote, design: .monospaced)) }
        }
        .navigationTitle("Font licences")
    }

    static func text(_ name: String) -> String {
        guard let url = Bundle.main.url(forResource: name, withExtension: "txt"), let s = try? String(contentsOf: url, encoding: .utf8) else { return "" }
        return s
    }
}
