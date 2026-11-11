import SwiftUI
import UIKit

/// iPad layout rules. On an iPhone (and an iPad at compact widths: Split View, Slide Over, a
/// narrow Stage Manager window) every helper here leaves the phone layout exactly as it is.
enum CrowLayout {
    /// One column of text and forms at the default text size: about 75 characters of Ubuntu body
    /// text. Scaled with Dynamic Type where it is used, so large text gets a wider column.
    static let readableWidth: CGFloat = 680
    /// Two columns side by side (Today on a wide iPad).
    static let wideWidth: CGFloat = 1080
    /// A short form on its own (connect, sign in).
    static let formWidth: CGFloat = 520
    /// Below this, side margins are not worth adding: the content is already about readable.
    static let minimumMargin: CGFloat = 24

    /// Horizontal margin that centres content at most `maxWidth` wide in a container `width` wide,
    /// or 0 when the container is narrower than that plus the minimum margins (an iPhone).
    static func margin(container width: CGFloat, maxWidth: CGFloat) -> CGFloat {
        let m = ((width - maxWidth) / 2).rounded(.down)
        return m >= minimumMargin ? m : 0
    }

    /// Whether Today can show its clock card and the next shifts side by side, from the width of
    /// its content column: each column then gets at least about 400 pt, a phone's width.
    static func todayIsWide(width: CGFloat, accessibilityText: Bool) -> Bool {
        !accessibilityText && width >= 820
    }

    /// Whether payslips can show the list beside a payslip: a 300–340 pt list and a payslip at
    /// least as wide as a phone's; at accessibility text sizes only a landscape 13-inch iPad
    /// without the sidebar has room for both.
    static func payslipsSideBySide(width: CGFloat, accessibilityText: Bool) -> Bool {
        width >= (accessibilityText ? 1200 : 720)
    }
}

/// The readable column on wide screens: horizontal safe-area padding, so `ScrollView`, `List` and
/// `Form` content (and their row backgrounds) stay at a readable width while the scroll area still
/// fills the screen. Padding of 0 on a phone is a no-op, so phone layouts are unchanged, and nothing
/// changes structure when an iPad rotates or resizes (no navigation state is lost). Safe-area
/// padding is layout, not environment: sheets presented from inside get their own width.
struct ReadableWidthModifier: ViewModifier {
    @ScaledMetric private var maxWidth: CGFloat
    @State private var width: CGFloat = 0

    init(maxWidth: CGFloat) { _maxWidth = ScaledMetric(wrappedValue: maxWidth, relativeTo: .body) }

    func body(content: Content) -> some View {
        content
            .safeAreaPadding(.horizontal, CrowLayout.margin(container: width, maxWidth: maxWidth))
            // The visible width: a scroll view's frame can extend under the sidebar or other
            // safe-area insets, which the padding then adds to.
            .onGeometryChange(for: CGFloat.self) { $0.size.width - $0.safeAreaInsets.leading - $0.safeAreaInsets.trailing } action: { width = $0 }
    }
}

extension View {
    /// Screen background used everywhere, with a readable column on wide screens
    /// (`ReadableWidthModifier`). `maxWidth` is the column at the default text size.
    func crowScreen(maxWidth: CGFloat = CrowLayout.readableWidth) -> some View {
        crowReadable(maxWidth: maxWidth)
            .background(Crow.background.ignoresSafeArea())
            .scrollContentBackground(.hidden)
    }

    /// Only the readable column, for screens that keep the system background.
    func crowReadable(maxWidth: CGFloat = CrowLayout.readableWidth) -> some View {
        modifier(ReadableWidthModifier(maxWidth: maxWidth))
    }

    /// A short form (connect, sign in) centred vertically on a big screen; top-aligned, as before,
    /// on a phone or in a short window. Apply to the scroll view's content.
    func crowCentredForm(viewport: CGFloat) -> some View {
        modifier(CentredFormModifier(viewport: viewport))
    }
}

struct CentredFormModifier: ViewModifier {
    @Environment(\.horizontalSizeClass) private var width
    @Environment(\.verticalSizeClass) private var height
    let viewport: CGFloat

    func body(content: Content) -> some View {
        let centre = width == .regular && height == .regular && viewport > 0
        content.frame(maxWidth: .infinity, minHeight: centre ? viewport : 0, alignment: centre ? .leading : .topLeading)
    }
}

/// The sidebar's destinations on an iPad, and where they live in the phone tab bar.
enum TabRouting {
    /// Tabs listed in the iPad sidebar only; at compact widths they are reached through More.
    static let sidebarOnly: Set<MainTab> = [.claims, .schedule, .profile, .settings]

    /// The selection to show after the window's width class changes (an iPad in Split View or a
    /// resized window), so the selected screen always has a visible tab: a sidebar-only tab becomes
    /// More with that screen pushed, and More with a screen pushed becomes that sidebar tab.
    static func adapt(tab: MainTab, morePath: [MainTab], sidebar: Bool) -> (tab: MainTab, morePath: [MainTab]) {
        if sidebar {
            if tab == .more, let first = morePath.first { return (first, []) }
            return (tab, morePath)
        }
        if sidebarOnly.contains(tab) { return (.more, [tab]) }
        return (tab, morePath)
    }
}

#if DEBUG
/// UI tests only (`-uitest-width <points>`): lays the app out in a strip that wide at the leading
/// edge of the window with the compact width class, as in a one-third Split View or Slide Over,
/// so the iPad's compact layout can be captured. The rest of the screen is a muted placeholder.
/// Sheets and alerts still present over the whole window (unlike real Split View).
struct SimulatedSplitView: ViewModifier {
    let width: CGFloat?

    func body(content: Content) -> some View {
        if let width {
            HStack(spacing: 0) {
                content
                    .frame(width: width)
                    .clipped()
                Rectangle().fill(Crow.hairline).frame(width: 1).ignoresSafeArea()
                Crow.surfaceMuted.ignoresSafeArea()
                    .overlay { Text("Other app").font(CrowFont.mono(.footnote)).foregroundStyle(Crow.muted) }
                    .accessibilityHidden(true)
            }
            .environment(\.horizontalSizeClass, .compact)
            .onAppear {
                for case let scene as UIWindowScene in UIApplication.shared.connectedScenes {
                    scene.traitOverrides.horizontalSizeClass = .compact
                    for window in scene.windows { window.rootViewController?.traitOverrides.horizontalSizeClass = .compact }
                }
            }
        } else {
            content
        }
    }
}
#endif
