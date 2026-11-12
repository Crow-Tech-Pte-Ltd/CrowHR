import Foundation
import LocalAuthentication
import Network
import Observation
import UIKit
import UserNotifications

/// One signed-in device session on one saved connection.
@MainActor
@Observable
final class Session {
    var connection: SavedConnection
    let api: APIClient
    let auth: AuthSession
    let queue: PunchQueue
    let queueStore: FilePunchQueueStore
    var me: Me?
    /// The `/me` fetch in flight, so a screen that needs it waits for it rather than starting a
    /// second one.
    var meLoad: Task<Void, Never>?
    var punches: [QueuedPunch] = []
    var lastDrain: DrainSummary?

    init(connection: SavedConnection, api: APIClient, auth: AuthSession, queueStore: FilePunchQueueStore) {
        self.connection = connection
        self.api = api
        self.auth = auth
        self.queueStore = queueStore
        self.queue = PunchQueue(store: queueStore)
    }

    func isAvailable(_ feature: AppFeature) -> Bool {
        FeatureGate.isAvailable(feature, serverFeatures: connection.features)
    }

    func reloadPunches() async { punches = await queue.all() }

    /// Approval tasks waiting for this person, nil until asked. Not only managers and admins
    /// decide: a step can go to the requester's manager by reporting line or to a named person,
    /// and out-of-office cover hands tasks to anyone, whatever their role.
    var approvalTasksWaiting: Int?

    func refreshApprovalTasks() async {
        guard isAvailable(.approvals) else { return }
        if let list: ApprovalTaskList = try? await api.get("/api/v1/approvals/tasks") { approvalTasksWaiting = list.items.count }
    }

    /// Unread notifications, for the Inbox tab's badge; nil until known.
    var unread: Int?

    func refreshUnread() async {
        if let c: UnreadCount = try? await api.get("/api/v1/notifications/unread-count") { unread = c.unread }
    }

    /// Sends this person's queued punches (FIFO). Punches from someone else stay untouched.
    func drainPunches(force: Bool = false) async {
        guard let membershipId = me?.membershipId ?? connection.membershipId else { return }
        lastDrain = await queue.drain(membershipId: membershipId, using: APIPunchSender(api: api), force: force)
        await reloadPunches()
    }
}

@MainActor
@Observable
final class AppModel {
    enum Screen: Equatable { case connect, signIn, main }

    let env: AppEnvironment
    private let connectionsStore: ConnectionStore
    private(set) var connections: [SavedConnection] = []
    private(set) var active: SavedConnection?
    private(set) var session: Session?
    var screen: Screen = .connect
    /// Shown on the sign-in screen after the server ended the session.
    var signedOutMessage: String?
    /// A `crowhr://connect` link waiting to be confirmed on the connect screen.
    var pendingLink: ConnectLink?
    var linkError: String?
    var locked = false
    /// What a tapped notification (local, or a row in the inbox) opens, waiting for the screen
    /// that shows it to take it (`AppTarget.tab`).
    var pendingTarget: AppTarget?
    var selectedTab: MainTab = .today
    /// Screens pushed on More's stack (phone tab bar). On an iPad with the sidebar they are tabs.
    var morePath: [MainTab] = []
    /// Whether the window currently shows the iPad sidebar (regular width), set by MainTabView.
    var sidebarAvailable = false
    /// iOS Settings has notifications turned off for the app, so the toggle can't turn them on.
    var notificationsBlocked = false
    private var backgroundedAt: Date?
    /// Unlocked (or signed in) since the app started: a cold start with the lock on asks first.
    private var unlockedThisLaunch = false
    private var pathMonitor: NWPathMonitor?
    private var drainTimer: Task<Void, Never>?

    var biometricEnabled: Bool {
        didSet {
            env.kv.set(Data([biometricEnabled ? 1 : 0]), forKey: "settings.biometric")
            // Turned on in the app: the person is here, unlocked.
            if biometricEnabled { unlockedThisLaunch = true }
        }
    }
    var notificationsEnabled: Bool {
        didSet { env.kv.set(Data([notificationsEnabled ? 1 : 0]), forKey: "settings.notifications") }
    }

    init(env: AppEnvironment) {
        self.env = env
        self.connectionsStore = ConnectionStore(store: env.kv)
        self.biometricEnabled = env.kv.data(forKey: "settings.biometric")?.first == 1
        self.notificationsEnabled = env.kv.data(forKey: "settings.notifications")?.first == 1
        reloadConnections()
        if let active {
            if env.tokens.load(account: active.id.uuidString) != nil {
                startSession(active)
                screen = .main
                locked = AppLockPolicy.shouldLock(enabled: biometricEnabled, unlockedThisLaunch: false, backgroundedAt: nil, now: Date())
            } else {
                screen = .signIn
            }
        }
        startConnectivityMonitor()
    }

    private func reloadConnections() {
        connections = connectionsStore.all()
        active = connectionsStore.active()
    }

    // MARK: Connect

    func check(server: ServerAddress, org: String?) async -> ConnectCheck {
        await APIClient.checkServer(server, org: org, transport: env.transport)
    }

    func connect(server: ServerAddress, organisation: ServerMeta.Organisation, meta: ServerMeta) throws(ConnectionStoreError) {
        let saved = try connectionsStore.save(server: server, orgSlug: organisation.slug, orgName: organisation.displayName, features: meta.features, logoUrl: organisation.logoUrl, now: Date())
        connectionsStore.setActive(saved.id)
        pendingLink = nil
        reloadConnections()
        resetNavigation()
        session = nil
        signedOutMessage = nil
        screen = env.tokens.load(account: saved.id.uuidString) != nil ? .main : .signIn
        if screen == .main { startSession(saved) }
    }

    func handle(url: URL) {
        do throws(ConnectLink.Invalid) {
            pendingLink = try ConnectLink.parse(url.absoluteString)
            linkError = nil
            screen = .connect
        } catch {
            linkError = error.message
            screen = .connect
        }
    }

    func addConnection() {
        pendingLink = nil
        screen = .connect
    }

    func cancelAddConnection() {
        pendingLink = nil
        screen = active == nil ? .connect : (session != nil ? .main : .signIn)
    }

    func switchTo(_ connection: SavedConnection) {
        connectionsStore.setActive(connection.id)
        reloadConnections()
        resetNavigation()
        session = nil
        signedOutMessage = nil
        if env.tokens.load(account: connection.id.uuidString) != nil {
            startSession(connection)
            screen = .main
        } else {
            screen = .signIn
        }
    }

    /// Removes a saved connection with its tokens and its punch queue (after confirmation in UI).
    /// Signed in there, its device session is revoked on its server too (best effort), as
    /// signing out does: deleting the tokens alone would leave it valid on the server.
    func remove(_ connection: SavedConnection) async {
        if session?.connection.id == connection.id {
            await signOut()
        } else if env.tokens.load(account: connection.id.uuidString) != nil {
            let api = APIClient(server: connection.server, transport: env.transport, auth: makeAuth(connection))
            try? await api.postNoContent("/api/v1/native/revoke")
        }
        env.tokens.delete(account: connection.id.uuidString)
        FilePunchQueueStore(fileURL: FilePunchQueueStore.defaultURL(connectionID: connection.id)).delete()
        connectionsStore.remove(connection.id)
        reloadConnections()
        if active == nil { screen = .connect }
    }

    // MARK: Sign-in

    func signIn(with authenticator: any WebAuthenticating) async throws {
        guard let connection = active else { return }
        let pkce = PKCE.generate()
        let state = PKCE.randomState()
        let url = NativeAuth.authorizeURL(server: connection.server, org: connection.orgSlug, pkce: pkce, state: state)
        let callback = try await authenticator.authenticate(url: url, callbackScheme: NativeAuth.callbackScheme)
        let code = try NativeAuth.code(fromCallback: callback, expectedState: state)
        let auth = makeAuth(connection)
        do {
            _ = try await auth.exchange(code: code, verifier: pkce.verifier, deviceName: NativeAuth.deviceName(model: UIDevice.current.model), appVersion: Self.appVersion)
        } catch let e as APIError {
            throw NativeAuthError.exchangeFailed(e.message)
        }
        // Who signed in is known only once `/me` answers. Until then nothing is sent: the stored
        // membership may be the previous person's, and their unsent punches must not go out
        // under this sign-in.
        var c = connection
        c.membershipId = nil
        c.displayName = nil
        connectionsStore.update(c)
        reloadConnections()
        signedOutMessage = nil
        unlockedThisLaunch = true
        startSession(c, auth: auth, afterSignIn: true)
        screen = .main
    }

    static var appVersion: String {
        (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0") + " (" + (Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0") + ")"
    }

    private func makeAuth(_ connection: SavedConnection) -> AuthSession {
        AuthSession(server: connection.server, account: connection.id.uuidString, store: env.tokens, transport: env.transport)
    }

    private func startSession(_ connection: SavedConnection, auth: AuthSession? = nil, afterSignIn: Bool = false) {
        let auth = auth ?? makeAuth(connection)
        let api = APIClient(server: connection.server, transport: env.transport, auth: auth) { [weak self] message in
            await self?.handleSignedOut(message)
        }
        let s = Session(connection: connection, api: api, auth: auth, queueStore: FilePunchQueueStore(fileURL: FilePunchQueueStore.defaultURL(connectionID: connection.id)))
        session = s
        startLoadingMe(s, afterSignIn: afterSignIn)
    }

    /// Who is signed in, when that isn't known yet: the app started offline, or `/me` failed.
    /// Retried when the app becomes active and when the network comes back; screens that need it
    /// (Leave) wait for it here, joining a fetch already under way.
    func refreshMeIfNeeded() async {
        guard let s = session, s.me == nil else { return }
        if s.meLoad == nil { startLoadingMe(s, afterSignIn: false) }
        await s.meLoad?.value
    }

    /// `/me` alone is what waiters wait for; the rest (the server's features, waiting punches, the
    /// inbox cursor) follows separately, so a slow drain never holds a screen on "Loading…".
    private func startLoadingMe(_ s: Session, afterSignIn: Bool) {
        let load = Task { await self.loadMe(s) }
        s.meLoad = load
        Task {
            await load.value
            s.meLoad = nil
            if s.me != nil { await self.afterMe(s, afterSignIn: afterSignIn) }
        }
    }

    private func loadMe(_ s: Session) async {
        await s.reloadPunches()
        guard let me: Me = try? await s.api.get("/api/v1/me") else { return }
        s.me = me
        var c = s.connection
        c.membershipId = me.membershipId
        c.displayName = me.user.displayName
        s.connection = c
        connectionsStore.update(c)
        reloadConnections()
    }

    /// Only right after signing in does it mark the inbox seen: a cold start can be iOS launching
    /// the app in the background for a refresh, which must still announce what is new.
    private func afterMe(_ s: Session, afterSignIn: Bool) async {
        // The server may have been upgraded since connecting: refresh its feature list.
        if case .compatible(let meta, let org) = await check(server: s.connection.server, org: s.connection.orgSlug) {
            var c = s.connection
            c.features = meta.features
            c.logoUrl = org.logoUrl
            s.connection = c
            connectionsStore.update(c)
            reloadConnections()
        }
        await s.refreshApprovalTasks()
        await refreshUnread()
        await s.drainPunches()
        if afterSignIn { await refresher(for: s).markAllSeen() }
    }

    /// The server ended the session (revoked on the web, suspended, expired): clear and go back to
    /// sign-in. Unsent punches stay, bound to their owner, and are sent after they sign in again.
    func handleSignedOut(_ message: String) async {
        guard session != nil else { return }
        session = nil
        signedOutMessage = message
        screen = active == nil ? .connect : .signIn
    }

    /// Signs out: revokes the device session on the server, deletes tokens, and (when the user
    /// confirmed) the unsent punches too.
    func signOut(discardUnsentPunches: Bool = false) async {
        guard let s = session else { return }
        try? await s.api.postNoContent("/api/v1/native/revoke")
        await s.auth.clear()
        if discardUnsentPunches { s.queueStore.delete() }
        env.kv.set(nil, forKey: "inbox.cursor.\(s.connection.id.uuidString)")
        session = nil
        resetNavigation()
        updateIconBadge()
        screen = .signIn
    }

    /// A different connection or person starts on Today: the old selection may be a screen the
    /// new server doesn't offer.
    private func resetNavigation() {
        selectedTab = .today
        morePath = []
        pendingTarget = nil
    }

    // MARK: Lifecycle

    func didEnterBackground() {
        backgroundedAt = Date()
        scheduleBackgroundRefresh()
    }

    func didBecomeActive() {
        if session != nil, AppLockPolicy.shouldLock(enabled: biometricEnabled, unlockedThisLaunch: unlockedThisLaunch, backgroundedAt: backgroundedAt, now: Date()) {
            locked = true
        }
        backgroundedAt = nil
        if let s = session {
            Task {
                await self.refreshMeIfNeeded()
                await self.refreshUnread()
                await s.drainPunches(force: true)
            }
        }
    }

    func unlock() async -> Bool {
        let context = LAContext()
        context.localizedFallbackTitle = "Use passcode"
        var problem: NSError?
        if !context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &problem), problem?.code == LAError.passcodeNotSet.rawValue {
            // The device has no passcode any more, so there is nothing to unlock with: turn the
            // lock off rather than keep the person out of the app for good.
            biometricEnabled = false
            unlocked()
            return true
        }
        do {
            let ok = try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Unlock Crow HR")
            if ok { unlocked() }
            return ok
        } catch {
            return false
        }
    }

    private func unlocked() {
        locked = false
        unlockedThisLaunch = true
    }

    var biometryAvailable: Bool {
        LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
    }

    /// "Face ID", "Touch ID" (most iPads but the Pro) or "Optic ID"; nil with no biometrics, when
    /// only the passcode unlocks.
    var biometryName: String? {
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        return switch context.biometryType {
        case .faceID: "Face ID"
        case .touchID: "Touch ID"
        case .opticID: "Optic ID"
        default: nil
        }
    }

    /// Retries queued punches when connectivity comes back, and every 30 s while some wait.
    private func startConnectivityMonitor() {
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { [weak self] path in
            guard path.status == .satisfied else { return }
            Task { @MainActor in
                await self?.refreshMeIfNeeded()
                await self?.session?.drainPunches(force: true)
            }
        }
        monitor.start(queue: DispatchQueue(label: "crowhr.path"))
        pathMonitor = monitor
        drainTimer = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                guard let s = self?.session, s.punches.contains(where: \.isPending) else { continue }
                await s.drainPunches()
            }
        }
    }

    // MARK: Background refresh and local notifications

    func refresher(for s: Session) -> InboxRefresher {
        let enabled = notificationsEnabled
        return InboxRefresher(fetcher: APIInboxFetcher(api: s.api), poster: UserNotificationPoster(), store: env.kv,
                              account: s.connection.id.uuidString, enabled: { enabled })
    }

    func scheduleBackgroundRefresh() {
        guard session != nil, notificationsEnabled else { return }
        try? RefreshPlanner(scheduler: BGTaskRefreshScheduler()).scheduleNext(now: Date())
    }

    /// Runs inside the BGAppRefreshTask.
    func performBackgroundRefresh() async {
        scheduleBackgroundRefresh()
        guard let s = session else { return }
        _ = try? await refresher(for: s).refresh()
        await refreshUnread()
    }

    /// The unread count for the Inbox tab's badge, and the app icon's when notifications are on.
    func refreshUnread() async {
        guard let s = session else { return }
        await s.refreshUnread()
        updateIconBadge()
    }

    /// Sets the count after a list that carries it (the notifications inbox) loaded.
    func setUnread(_ count: Int) {
        session?.unread = count
        updateIconBadge()
    }

    /// The app icon shows the unread count only while the app may notify; otherwise none.
    func updateIconBadge() {
        let count = notificationsEnabled ? (session?.unread ?? 0) : 0
        Task { try? await UNUserNotificationCenter.current().setBadgeCount(count) }
    }

    func setNotifications(_ on: Bool) async {
        if on {
            let center = UNUserNotificationCenter.current()
            let granted = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
            notificationsEnabled = granted
            // Refused before: iOS doesn't ask again, and the toggle would just flip back.
            let status = await center.notificationSettings().authorizationStatus
            notificationsBlocked = !granted && status == .denied
        } else {
            notificationsEnabled = false
        }
        if notificationsEnabled { scheduleBackgroundRefresh() }
        updateIconBadge()
    }

    /// Whether iOS Settings has notifications off for the app (turned off there after being
    /// allowed, say), for Settings to explain.
    func checkNotificationPermission() async {
        notificationsBlocked = (await UNUserNotificationCenter.current().notificationSettings()).authorizationStatus == .denied
    }

    /// Opens what a notification is about: its screen, with the item for that screen to open
    /// (`pendingTarget`). Opened from a local notification, the notification is marked read, as a
    /// tap on it in the inbox does. A screen the server doesn't offer leaves it in the inbox.
    func open(_ target: AppTarget, notificationID: String? = nil) {
        guard screen == .main, let s = session else { return }
        if let notificationID {
            Task {
                try? await s.api.postNoContent("/api/v1/notifications/\(notificationID)/read")
                await self.refreshUnread()
            }
        }
        var t = target
        if let feature = t.tab.feature, !s.isAvailable(feature) { t = .notifications }
        pendingTarget = t
        go(to: t.tab)
    }

    /// Keyboard shortcuts (`GoShortcuts`): the screen's tab, or More with the screen pushed
    /// when there's no sidebar.
    func go(to tab: MainTab) {
        guard screen == .main, let session, tab.feature.map(session.isAvailable) ?? true else { return }
        let next = TabRouting.adapt(tab: tab, morePath: [], sidebar: sidebarAvailable)
        // More's stack first, so the tab switch shows the screen already pushed.
        morePath = next.morePath
        selectedTab = next.tab
    }

    /// Adapts the selection when the window gains or loses the sidebar (Split View, resizing).
    func sidebarChanged(_ available: Bool) {
        sidebarAvailable = available
        let next = TabRouting.adapt(tab: selectedTab, morePath: morePath, sidebar: available)
        selectedTab = next.tab
        morePath = next.morePath
    }
}

/// The main screens. On a phone (and an iPad at compact widths) the tab bar has Today, Leave, Pay,
/// Inbox and More, and More pushes the rest; the iPad sidebar lists them all.
enum MainTab: Hashable {
    case today, leave, pay, inbox, claims, schedule, profile, settings, more

    /// The server feature a tab needs, if any (`FeatureGate`).
    var feature: AppFeature? {
        switch self {
        case .leave: .leave
        case .pay: .payslips
        case .claims: .claims
        case .schedule: .schedule
        default: nil
        }
    }
}
