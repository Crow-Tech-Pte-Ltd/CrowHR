import SwiftUI

/// Every screen's states: loading, loaded (maybe empty), error, offline.
enum LoadState<Value: Sendable>: Sendable {
    case loading
    case loaded(Value)
    case failed(APIError)

    var value: Value? { if case .loaded(let v) = self { v } else { nil } }

    /// The state after a load failed, or nil to keep the current one. A cancelled load (the
    /// screen went away mid-load, such as a quick switch to another tab) changes nothing, so the
    /// screen loads again when it's back; before, it then said "You're offline" until Try again.
    /// Content already showing stays on a passing failure (offline, a server hiccup).
    static func after(failure error: any Error, cancelled: Bool, current: LoadState) -> LoadState? {
        if cancelled || APIError.isCancellation(error) { return nil }
        let e = APIError.from(error, host: "")
        if case .loaded = current, e.isTransient { return nil }
        return .failed(e)
    }

    /// Applies a failed load (`after(failure:cancelled:current:)`) in the current task.
    mutating func fail(_ error: any Error) {
        if let next = Self.after(failure: error, cancelled: Task.isCancelled, current: self) { self = next }
    }
}

extension LoadState: Equatable where Value: Equatable {}

/// Loads `Value` with `load`, showing loading, error and offline states, then `content`.
struct AsyncContent<Value: Sendable, Content: View>: View {
    @Binding var state: LoadState<Value>
    let load: @MainActor () async throws -> Value
    @ViewBuilder let content: (Value) -> Content

    var body: some View {
        Group {
            switch state {
            case .loading:
                VStack(spacing: 12) {
                    ProgressView()
                    Text("Loading…").font(CrowFont.mono(.footnote)).foregroundStyle(Crow.muted)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("state.loading")
            case .failed(let error):
                ErrorStateView(error: error) { Task { await reload() } }
            case .loaded(let value):
                content(value)
            }
        }
        // Each time the screen shows: the first load, a retry after a failure, or a quiet refresh
        // of what is showing (a decision on the web, leave applied elsewhere).
        .task { await reload() }
    }

    @MainActor func reload() async {
        do { state = .loaded(try await load()) } catch { state.fail(error) }
    }
}

struct ErrorStateView: View {
    let error: APIError
    let retry: () -> Void

    var body: some View {
        let offline = error == .offline
        VStack(spacing: 14) {
            Image(systemName: offline ? "wifi.slash" : "exclamationmark.triangle")
                .font(.system(size: 28))
                .foregroundStyle(offline ? Crow.muted : Crow.danger)
                .accessibilityHidden(true)
            Text(offline ? "You're offline" : "Something went wrong")
                .font(CrowFont.mono(.headline, weight: .semibold))
                .foregroundStyle(Crow.ink)
            Text(error.message)
                .font(CrowFont.body(.subheadline))
                .foregroundStyle(Crow.muted)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Button("Try again", action: retry)
                .buttonStyle(.crowSecondary)
                .frame(maxWidth: 240)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityIdentifier(offline ? "state.offline" : "state.error")
    }
}

struct EmptyStateView: View {
    let title: String
    let message: String
    var systemImage: String = "tray"

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: systemImage).font(.system(size: 26)).foregroundStyle(Crow.muted).accessibilityHidden(true)
            Text(title).font(CrowFont.mono(.headline, weight: .semibold)).foregroundStyle(Crow.ink)
            Text(message)
                .font(CrowFont.body(.subheadline))
                .foregroundStyle(Crow.muted)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(24)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("state.empty")
    }
}
