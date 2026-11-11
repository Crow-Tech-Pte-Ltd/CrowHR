import SwiftUI
import UserNotifications

@main
struct CrowHRApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @State private var model: AppModel
    @Environment(\.scenePhase) private var scenePhase

    init() {
        CrowAppearance.apply()
        let model = AppModel(env: .live())
        _model = State(initialValue: model)
        AppDelegate.onRoute = { route in model.open(route: route) }
    }

    var body: some Scene {
        WindowGroup {
            #if DEBUG
            if model.env.isUITest && ProcessInfo.processInfo.arguments.contains("-uitest-a11y-lab") {
                A11yAuditLabView()
            } else {
                RootView()
                    .environment(model)
                    .onOpenURL { model.handle(url: $0) }
            }
            #else
            RootView()
                .environment(model)
                .onOpenURL { model.handle(url: $0) }
            #endif
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background: model.didEnterBackground()
            case .active: model.didBecomeActive()
            default: break
            }
        }
        .backgroundTask(.appRefresh(BackgroundRefresh.taskIdentifier)) {
            await model.performBackgroundRefresh()
        }
    }
}

/// Routes taps on the content-free local notification to the right inbox.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    @MainActor static var onRoute: (@MainActor (LocalNotice.Route) -> Void)?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let raw = response.notification.request.content.userInfo["route"] as? String
        let route = raw.flatMap(LocalNotice.Route.init(rawValue:)) ?? .notifications
        await MainActor.run { AppDelegate.onRoute?(route) }
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list]
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            Group {
                switch model.screen {
                case .connect: NavigationStack { ConnectView() }
                case .signIn: NavigationStack { SignInView() }
                case .main:
                    if let session = model.session { MainTabView().environment(session) } else { NavigationStack { SignInView() } }
                }
            }
            .tint(Crow.biru)
            if model.locked {
                LockView()
            } else if scenePhase != .active {
                // App switcher snapshot is obscured (spec "Zero data collection").
                PrivacyCover()
            }
        }
        .font(CrowFont.body())
        .foregroundStyle(Crow.ink)
        .preferredColorScheme(model.env.forceDark ? .dark : nil)
    }
}

struct PrivacyCover: View {
    var body: some View {
        ZStack {
            Crow.background.ignoresSafeArea()
            VStack(spacing: 12) {
                CrowMark()
                Text("Crow HR").font(CrowFont.mono(.title3, weight: .semibold))
            }
        }
        .accessibilityHidden(true)
    }
}

struct LockView: View {
    @Environment(AppModel.self) private var model
    @State private var failed = false

    var body: some View {
        ZStack {
            Crow.background.ignoresSafeArea()
            VStack(spacing: 20) {
                CrowMark()
                Text("Crow HR is locked").font(CrowFont.mono(.title3, weight: .semibold))
                if failed {
                    Text("Couldn't unlock. Try again, or use your passcode.").font(CrowFont.body(.subheadline)).foregroundStyle(Crow.muted)
                }
                Button("Unlock") { Task { failed = !(await model.unlock()) } }
                    .buttonStyle(.crowPrimary)
                    .frame(maxWidth: 280)
                    .accessibilityIdentifier("lock.unlock")
            }
            .padding(24)
        }
        .task { failed = !(await model.unlock()) }
    }
}

/// The small brand chip: "HR" on kuning with an ink border. Decorative.
struct CrowMark: View {
    var size: CGFloat = 44
    var body: some View {
        Text("HR")
            // Fixed: the chip has a fixed size, and the mark is decorative (hidden from VoiceOver).
            // Scaled with Dynamic Type, "HR" became "…" at the largest sizes.
            .font(.custom("AzeretMono-SemiBold", fixedSize: size * 0.38))
            .foregroundStyle(Crow.onKuning)
            .frame(width: size, height: size)
            // Rounded like the web wordmark's HR chip (4 px on an ~18 px chip).
            .background(RoundedRectangle(cornerRadius: size * 0.22).fill(Crow.kuning))
            .overlay(RoundedRectangle(cornerRadius: size * 0.22).strokeBorder(Color(red: 0.04, green: 0.04, blue: 0.04), lineWidth: 2))
            .accessibilityHidden(true)
    }
}
