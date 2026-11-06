import Foundation

/// A saved server + organisation. Not secret (tokens live in the Keychain, keyed by `id`).
struct SavedConnection: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    var server: ServerAddress
    var orgSlug: String
    var orgName: String
    var features: [String]
    var lastUsedAt: Date
    /// Set after a successful sign-in; used to bind queued punches to the person who made them.
    var membershipId: String?
    var displayName: String?
}

enum ConnectionStoreError: Error, Equatable, Sendable {
    case full

    var message: String {
        ConnectMessages.tooManyConnections
    }
}

/// Key-value persistence seam (UserDefaults in the app, a dictionary in tests).
protocol KeyValueStore: AnyObject, Sendable {
    func data(forKey key: String) -> Data?
    func set(_ data: Data?, forKey key: String)
}

final class UserDefaultsStore: KeyValueStore, @unchecked Sendable {
    private let defaults: UserDefaults
    init(_ defaults: UserDefaults = .standard) { self.defaults = defaults }
    func data(forKey key: String) -> Data? { defaults.data(forKey: key) }
    func set(_ data: Data?, forKey key: String) {
        if let data { defaults.set(data, forKey: key) } else { defaults.removeObject(forKey: key) }
    }
}

final class MemoryStore: KeyValueStore, @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String: Data] = [:]
    init() {}
    func data(forKey key: String) -> Data? { lock.withLock { values[key] } }
    func set(_ data: Data?, forKey key: String) { lock.withLock { values[key] = data } }
}

/// Up to five saved connections, most recently used first (spec "Connect to a company server").
struct ConnectionStore: Sendable {
    static let maxConnections = 5
    private static let key = "connections.v1"
    private static let activeKey = "connections.active.v1"
    let store: any KeyValueStore

    init(store: any KeyValueStore) { self.store = store }

    func all() -> [SavedConnection] {
        guard let data = store.data(forKey: Self.key),
              let list = try? JSONDecoder().decode([SavedConnection].self, from: data)
        else { return [] }
        return list.sorted { $0.lastUsedAt > $1.lastUsedAt }
    }

    var activeID: UUID? {
        guard let d = store.data(forKey: Self.activeKey), let s = String(data: d, encoding: .utf8) else { return nil }
        return UUID(uuidString: s)
    }

    func active() -> SavedConnection? {
        guard let id = activeID else { return nil }
        return all().first { $0.id == id }
    }

    func setActive(_ id: UUID?) {
        store.set(id.map { Data($0.uuidString.utf8) }, forKey: Self.activeKey)
    }

    /// Adds or updates (same server and organisation → same entry). A sixth connection is refused,
    /// never silently replacing one the user saved.
    @discardableResult
    func save(server: ServerAddress, orgSlug: String, orgName: String, features: [String], now: Date) throws(ConnectionStoreError) -> SavedConnection {
        var list = all()
        if let i = list.firstIndex(where: { $0.server == server && $0.orgSlug == orgSlug }) {
            list[i].orgName = orgName
            list[i].features = features
            list[i].lastUsedAt = now
            write(list)
            return list[i]
        }
        guard list.count < Self.maxConnections else { throw .full }
        let c = SavedConnection(id: UUID(), server: server, orgSlug: orgSlug, orgName: orgName, features: features, lastUsedAt: now, membershipId: nil, displayName: nil)
        list.append(c)
        write(list)
        return c
    }

    func update(_ connection: SavedConnection) {
        var list = all()
        guard let i = list.firstIndex(where: { $0.id == connection.id }) else { return }
        list[i] = connection
        write(list)
    }

    func remove(_ id: UUID) {
        write(all().filter { $0.id != id })
        if activeID == id { setActive(nil) }
    }

    private func write(_ list: [SavedConnection]) {
        store.set(try? JSONEncoder().encode(list), forKey: Self.key)
    }
}
