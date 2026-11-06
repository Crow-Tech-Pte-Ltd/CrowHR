import CoreLocation
import Foundation

/// One location fix for a punch, only when the organisation's attendance policy asks for it.
/// "While using" permission only; nothing is tracked in the background.
@MainActor
final class LocationProvider {
    func current(timeout: Duration = .seconds(8)) async -> PunchLocation? {
        let manager = CLLocationManager()
        switch manager.authorizationStatus {
        case .denied, .restricted: return nil
        default: break
        }
        let session = CLServiceSession(authorization: .whenInUse)
        defer { session.invalidate() }
        return await withTaskGroup(of: PunchLocation?.self) { group in
            group.addTask {
                do {
                    for try await update in CLLocationUpdate.liveUpdates() {
                        if update.authorizationDenied || update.authorizationDeniedGlobally { return nil }
                        if let l = update.location {
                            return PunchLocation(latitude: l.coordinate.latitude, longitude: l.coordinate.longitude,
                                                 accuracyMetres: l.horizontalAccuracy >= 0 ? l.horizontalAccuracy : nil)
                        }
                    }
                } catch {}
                return nil
            }
            group.addTask {
                try? await Task.sleep(for: timeout)
                return nil
            }
            let first = await group.next() ?? nil
            group.cancelAll()
            return first
        }
    }
}
