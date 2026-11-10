import Foundation
import Security

/// Dependencies chosen at launch. UI-test switches exist only in DEBUG builds and only with the
/// `-uitest` launch argument; Release builds have none of them.
struct AppEnvironment: Sendable {
    let transport: any HTTPTransport
    let tokens: any TokenStoring
    let kv: any KeyValueStore
    let recorder: NetworkRecorder?
    let outage: SimulatedOutage?
    let isUITest: Bool
    let cameraStub: Bool
    /// UI-test QA only: render in dark mode regardless of the simulator setting.
    var forceDark = false
    /// UI-test store screenshots only (`-uitest-store`): hide the test-only controls.
    var storeScreenshots = false

    static func live(arguments: [String] = ProcessInfo.processInfo.arguments) -> AppEnvironment {
        #if DEBUG
        if arguments.contains("-uitest") {
            let defaults = UserDefaults(suiteName: "crowtech.crowhr.uitest")!
            if arguments.contains("-uitest-reset") {
                defaults.removePersistentDomain(forName: "crowtech.crowhr.uitest")
                KeychainTokenStore(service: KeychainTokenStore.service + ".uitest").deleteAll()
                let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("CrowHR")
                try? FileManager.default.removeItem(at: dir)
            }
            let recorder = NetworkRecorder()
            let outage = SimulatedOutage()
            let transport = RecordingTransport(inner: OutageTransport(inner: URLSessionTransport(), outage: outage), recorder: recorder)
            return AppEnvironment(transport: transport, tokens: KeychainTokenStore(service: KeychainTokenStore.service + ".uitest"),
                                  kv: UserDefaultsStore(defaults), recorder: recorder, outage: outage, isUITest: true,
                                  cameraStub: arguments.contains("-uitest-camera-stub"), forceDark: arguments.contains("-uitest-dark"),
                                  storeScreenshots: arguments.contains("-uitest-store"))
        }
        #endif
        return AppEnvironment(transport: URLSessionTransport(), tokens: KeychainTokenStore(), kv: UserDefaultsStore(),
                              recorder: nil, outage: nil, isUITest: false, cameraStub: false)
    }
}

/// UI tests only: makes every request fail as if the phone had no signal, to exercise the
/// offline punch queue on a simulator that shares the Mac's network.
final class SimulatedOutage: @unchecked Sendable {
    private let lock = NSLock()
    private var on = false
    var isOn: Bool {
        get { lock.withLock { on } }
        set { lock.withLock { on = newValue } }
    }
}

struct OutageTransport: HTTPTransport {
    let inner: any HTTPTransport
    let outage: SimulatedOutage
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        if outage.isOn { throw URLError(.notConnectedToInternet) }
        return try await inner.send(request)
    }
}

extension KeychainTokenStore {
    func deleteAll() {
        SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service] as CFDictionary)
    }
}
