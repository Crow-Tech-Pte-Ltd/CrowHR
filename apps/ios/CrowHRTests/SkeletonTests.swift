import Foundation
import Testing
import UIKit
@testable import CrowHR

/// Task 3.1: the project skeleton builds, bundles its fonts, declares its privacy manifest and the
/// capabilities it uses, and nothing else.
@Suite("Skeleton")
struct SkeletonTests {
    let info = Bundle.main.infoDictionary ?? [:]

    @Test func bundleIdentifierIsCrowHR() {
        #expect(Bundle.main.bundleIdentifier == "crowtech.crowhr")
        #expect(info["CFBundleDisplayName"] as? String == "Crow HR")
    }

    @Test(arguments: CrowFont.fontNames)
    func bundledFontIsRegistered(_ name: String) {
        #expect(UIFont(name: name, size: 17) != nil, "\(name) is not registered")
    }

    @Test func fontLicencesAreBundled() {
        #expect(LicencesView.text("AzeretMono-OFL").contains("SIL OPEN FONT LICENSE"))
        #expect(LicencesView.text("Ubuntu-LICENCE").contains("UBUNTU FONT LICENCE"))
    }

    @Test func privacyManifestDeclaresNoTrackingAndNoCollectedData() throws {
        let url = try #require(Bundle.main.url(forResource: "PrivacyInfo", withExtension: "xcprivacy"))
        let plist = try #require(try PropertyListSerialization.propertyList(from: Data(contentsOf: url), format: nil) as? [String: Any])
        #expect(plist["NSPrivacyTracking"] as? Bool == false)
        #expect((plist["NSPrivacyTrackingDomains"] as? [Any])?.isEmpty == true)
        #expect((plist["NSPrivacyCollectedDataTypes"] as? [Any])?.isEmpty == true)
        let apis = try #require(plist["NSPrivacyAccessedAPITypes"] as? [[String: Any]])
        let reasons = Dictionary(uniqueKeysWithValues: apis.map { ($0["NSPrivacyAccessedAPIType"] as! String, $0["NSPrivacyAccessedAPITypeReasons"] as! [String]) })
        #expect(reasons == [
            "NSPrivacyAccessedAPICategoryUserDefaults": ["CA92.1"],
            "NSPrivacyAccessedAPICategorySystemBootTime": ["35F9.1"],
        ])
    }

    /// 1.0.0 ships for iPhone only (project.yml TARGETED_DEVICE_FAMILY); iPad runs it in iPhone mode.
    @Test func iPhoneOnly() {
        #expect(info["UIDeviceFamily"] as? [Int] == [1])
    }

    /// Export compliance: HTTPS through the system's URLSession only, no own encryption.
    @Test func usesNoNonExemptEncryption() {
        #expect(info["ITSAppUsesNonExemptEncryption"] as? Bool == false)
    }

    @Test func connectSchemeIsRegisteredButNotTheSignInRedirect() {
        let types = info["CFBundleURLTypes"] as? [[String: Any]] ?? []
        let schemes = types.flatMap { $0["CFBundleURLSchemes"] as? [String] ?? [] }
        #expect(schemes == ["crowhr"])
    }

    @Test func backgroundRefreshButNoRemotePush() {
        let modes = info["UIBackgroundModes"] as? [String] ?? []
        #expect(modes == ["fetch"])
        #expect(!modes.contains("remote-notification"))
        #expect(info["BGTaskSchedulerPermittedIdentifiers"] as? [String] == [BackgroundRefresh.taskIdentifier])
    }

    @Test func transportSecurityAllowsOnlyLocalNetworkingExceptions() {
        let ats = info["NSAppTransportSecurity"] as? [String: Any] ?? [:]
        #expect(ats["NSAllowsLocalNetworking"] as? Bool == true)
        #expect(ats["NSAllowsArbitraryLoads"] == nil)
        // From iOS 17 IP addresses need explicit entries: only the private IPv4 ranges (RFC 1918),
        // each allowing plain HTTP and nothing else. No public host is ever exempt.
        let domains = ats["NSExceptionDomains"] as? [String: [String: Any]] ?? [:]
        #expect(Set(domains.keys) == ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"])
        for (range, rules) in domains {
            #expect(Set(rules.keys) == ["NSExceptionAllowsInsecureHTTPLoads"], "\(range) has extra rules")
            #expect(rules["NSExceptionAllowsInsecureHTTPLoads"] as? Bool == true)
        }
    }

    @Test func everyPermissionPromptExplainsItself() {
        for key in ["NSCameraUsageDescription", "NSFaceIDUsageDescription", "NSLocalNetworkUsageDescription", "NSLocationWhenInUseUsageDescription", "NSPhotoLibraryUsageDescription"] {
            #expect(((info[key] as? String) ?? "").count > 30, "\(key) missing")
        }
        #expect(info["NSLocationAlwaysAndWhenInUseUsageDescription"] == nil)
    }

    @Test func noThirdPartyFrameworksAreEmbedded() throws {
        let frameworks = Bundle.main.privateFrameworksURL
        let embedded = (try? FileManager.default.contentsOfDirectory(atPath: frameworks?.path() ?? "")) ?? []
        // Xcode may embed Swift support or test-host libraries in Debug; nothing else belongs here.
        let foreign = embedded.filter { !$0.hasPrefix("libswift") && !$0.hasPrefix("XC") && !$0.hasPrefix("Testing") && !$0.hasPrefix("libXCTest") && !$0.hasPrefix("lib_TestingInterop") }
        #expect(foreign.isEmpty, "Unexpected embedded frameworks: \(foreign)")
    }
}
