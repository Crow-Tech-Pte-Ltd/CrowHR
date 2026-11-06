import Foundation

/// `GET /api/v1/meta`. Decoding is lenient: unknown fields are ignored and unknown sign-in kinds
/// are kept as strings, so newer servers don't break older apps (add-mobile-apps decision 1).
struct ServerMeta: Decodable, Equatable, Sendable {
    let serverVersion: String
    let apiVersions: [String]
    let features: [String]
    let demo: Bool
    let orgSlugRequired: Bool
    let organisations: [Organisation]

    struct Organisation: Decodable, Equatable, Sendable {
        let slug: String
        let displayName: String
        let logoUrl: String?
        let signInMethods: [SignInMethod]
    }

    struct SignInMethod: Decodable, Equatable, Sendable {
        let kind: String
        let displayName: String
    }

    enum CodingKeys: String, CodingKey {
        case serverVersion, apiVersions, features, demo, orgSlugRequired, organisations
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        serverVersion = try c.decode(String.self, forKey: .serverVersion)
        apiVersions = try c.decode([String].self, forKey: .apiVersions)
        features = try c.decodeIfPresent([String].self, forKey: .features) ?? []
        demo = try c.decodeIfPresent(Bool.self, forKey: .demo) ?? false
        orgSlugRequired = try c.decodeIfPresent(Bool.self, forKey: .orgSlugRequired) ?? false
        organisations = try c.decodeIfPresent([Organisation].self, forKey: .organisations) ?? []
    }

    init(serverVersion: String, apiVersions: [String], features: [String], demo: Bool, orgSlugRequired: Bool, organisations: [Organisation]) {
        self.serverVersion = serverVersion
        self.apiVersions = apiVersions
        self.features = features
        self.demo = demo
        self.orgSlugRequired = orgSlugRequired
        self.organisations = organisations
    }
}

/// The outcome of checking a server before connecting (fixture outcomes in
/// apps/mobile-fixtures/connect-cases.json).
enum ConnectCheck: Equatable, Sendable {
    case compatible(meta: ServerMeta, organisation: ServerMeta.Organisation)
    /// Multi-organisation install: the user must name the organisation (from the QR code).
    case organisationRequired(meta: ServerMeta)
    case organisationNotFound(slug: String)
    /// The server only speaks API versions newer than this app understands.
    case appUpdateRequired(serverVersions: [String])
    /// The server is older than any API version this app understands.
    case serverUpdateRequired(serverVersions: [String])
    case notCrowHR
    case noSignInMethods(organisation: ServerMeta.Organisation)
    case unreachable
    case tlsError

    var outcome: String {
        switch self {
        case .compatible: "ok"
        case .organisationRequired: "org_required"
        case .organisationNotFound: "org_not_found"
        case .appUpdateRequired: "app_too_old"
        case .serverUpdateRequired: "server_too_old"
        case .notCrowHR: "not_crowhr"
        case .noSignInMethods: "no_sign_in_methods"
        case .unreachable: "unreachable"
        case .tlsError: "tls_error"
        }
    }

    var message: String? {
        switch self {
        case .compatible: nil
        case .organisationRequired: ConnectMessages.orgRequired
        case .organisationNotFound: ConnectMessages.orgNotFound
        case .appUpdateRequired: ConnectMessages.appTooOld
        case .serverUpdateRequired: ConnectMessages.serverTooOld
        case .notCrowHR: ConnectMessages.notCrowHR
        case .noSignInMethods: ConnectMessages.noSignInMethods
        case .unreachable: ConnectMessages.unreachable
        case .tlsError: ConnectMessages.tlsError
        }
    }
}

enum Compatibility {
    /// API major versions this build understands.
    static let supportedAPIVersions: [String] = ["v1"]

    /// Anything that isn't Crow HR meta JSON (an HTML page, another product's JSON, a 404) is
    /// `.notCrowHR`; a 5xx means the server is there but unwell, so `.unreachable`.
    static func check(status: Int, contentType: String?, body: Data, requestedOrg: String?) -> ConnectCheck {
        if status >= 500 || status == 408 || status == 429 { return .unreachable }
        guard (200..<300).contains(status),
              (contentType ?? "").lowercased().contains("json"),
              let meta = try? JSONDecoder().decode(ServerMeta.self, from: body)
        else { return .notCrowHR }
        return check(meta: meta, requestedOrg: requestedOrg)
    }

    static func check(meta: ServerMeta, requestedOrg: String?) -> ConnectCheck {
        if !meta.apiVersions.contains(where: supportedAPIVersions.contains) {
            let majors = meta.apiVersions.compactMap { Int($0.dropFirst()) }
            let ours = supportedAPIVersions.compactMap { Int($0.dropFirst()) }
            if let maxOurs = ours.max(), !majors.isEmpty, majors.allSatisfy({ $0 > maxOurs }) {
                return .appUpdateRequired(serverVersions: meta.apiVersions)
            }
            return .serverUpdateRequired(serverVersions: meta.apiVersions)
        }
        let wanted = requestedOrg?.lowercased()
        if let wanted {
            guard let org = meta.organisations.first(where: { $0.slug.lowercased() == wanted }) else {
                return .organisationNotFound(slug: wanted)
            }
            return org.signInMethods.isEmpty ? .noSignInMethods(organisation: org) : .compatible(meta: meta, organisation: org)
        }
        if meta.orgSlugRequired || meta.organisations.isEmpty { return .organisationRequired(meta: meta) }
        if meta.organisations.count == 1, let org = meta.organisations.first {
            return org.signInMethods.isEmpty ? .noSignInMethods(organisation: org) : .compatible(meta: meta, organisation: org)
        }
        return .organisationRequired(meta: meta)
    }
}

/// Screens and the server features they need (add-mobile-apps decision 2: feature detection, not
/// version comparison).
enum AppFeature: String, CaseIterable, Sendable, Codable {
    case payslips, leave, clock, claims, schedule, approvals, notifications

    var title: String {
        switch self {
        case .clock: "Clock in"
        case .leave: "Leave"
        case .payslips: "Payslips"
        case .claims: "Claims"
        case .schedule: "Schedule"
        case .approvals: "Approvals"
        case .notifications: "Notifications"
        }
    }

    /// The `features` entry in meta that enables this screen.
    var serverFeature: String {
        switch self {
        case .clock: "attendance.offlinePunch"
        case .leave: "leave"
        case .payslips: "payslips"
        case .claims: "claims"
        case .schedule: "scheduling"
        case .approvals: "approvals"
        case .notifications: "notifications"
        }
    }
}

enum FeatureGate {
    /// Modules that shipped in the first `/api/v1` release without a meta feature flag. Every v1
    /// server has them, so they need no flag; the app still honours the flag once servers list it.
    /// NOT IMPLEMENTED (server): meta should list `payslips`, `claims`, `scheduling`, `approvals`
    /// and `notifications` so a server can switch them off; reported to the lead.
    static let v1Baseline: Set<String> = ["payslips", "claims", "scheduling", "approvals", "notifications"]

    static func isAvailable(_ feature: AppFeature, serverFeatures: [String]) -> Bool {
        serverFeatures.contains(feature.serverFeature) || v1Baseline.contains(feature.serverFeature)
    }

    static func available(serverFeatures: [String]) -> [AppFeature] {
        AppFeature.allCases.filter { isAvailable($0, serverFeatures: serverFeatures) }
    }

    /// Settings copy for each screen hidden because the server is older than the app.
    static func unavailableMessages(serverFeatures: [String]) -> [String] {
        AppFeature.allCases.filter { !isAvailable($0, serverFeatures: serverFeatures) }.map {
            ConnectMessages.featureUnavailable($0.title)
        }
    }
}
