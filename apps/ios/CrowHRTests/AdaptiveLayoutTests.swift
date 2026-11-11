import CoreGraphics
import Testing
@testable import CrowHR

/// iPad layout rules (Design/Adaptive.swift): phone widths keep the phone layout; wide screens get
/// a centred readable column; the tab selection always has a visible tab after the iPad's window
/// gains or loses the sidebar.
@Suite("Adaptive layout")
struct AdaptiveLayoutTests {
    // Point widths: iPhone 17 Pro Max 440; iPad 13-inch 1032 x 1376; one-third Split View ~ 390;
    // an 11-inch iPad 834 x 1210.
    @Test(arguments: [320.0, 375, 402, 440, 680, 700, 727])
    func phoneAndNarrowWidthsGetNoMargin(width: Double) {
        #expect(CrowLayout.margin(container: width, maxWidth: CrowLayout.readableWidth) == 0)
    }

    @Test func wideScreensCentreAReadableColumn() {
        #expect(CrowLayout.margin(container: 1032, maxWidth: 680) == 176)
        #expect(CrowLayout.margin(container: 1376, maxWidth: 680) == 348)
        #expect(CrowLayout.margin(container: 834, maxWidth: 680) == 77)
        // The column is exactly the readable width whenever there is a margin.
        for width in stride(from: 728.0, through: 1400, by: 37) {
            let m = CrowLayout.margin(container: width, maxWidth: 680)
            #expect(width - 2 * m >= 680 && width - 2 * m <= 681)
        }
    }

    @Test func todayGoesSideBySideOnlyWhenWideAndNotAtAccessibilitySizes() {
        // Content column widths: the screen less 20 pt padding each side (and any sidebar).
        #expect(!CrowLayout.todayIsWide(width: 400, accessibilityText: false)) // iPhone 17 Pro Max
        #expect(!CrowLayout.todayIsWide(width: 794, accessibilityText: false)) // 11-inch portrait
        #expect(CrowLayout.todayIsWide(width: 992, accessibilityText: false)) // 13-inch portrait
        #expect(CrowLayout.todayIsWide(width: 1056, accessibilityText: false)) // 13-inch landscape, sidebar
        #expect(!CrowLayout.todayIsWide(width: 1336, accessibilityText: true))
    }

    @Test func payslipsSitBesideTheListOnlyWithRoom() {
        #expect(!CrowLayout.payslipsSideBySide(width: 440, accessibilityText: false))
        // An 11-inch iPad in portrait beside the sidebar (834 - 320).
        #expect(!CrowLayout.payslipsSideBySide(width: 514, accessibilityText: false))
        #expect(CrowLayout.payslipsSideBySide(width: 834, accessibilityText: false))
        #expect(CrowLayout.payslipsSideBySide(width: 1056, accessibilityText: false))
        #expect(!CrowLayout.payslipsSideBySide(width: 834, accessibilityText: true))
        #expect(!CrowLayout.payslipsSideBySide(width: 1032, accessibilityText: true))
        #expect(CrowLayout.payslipsSideBySide(width: 1376, accessibilityText: true))
    }

    @Test func sidebarOnlyTabsMoveUnderMoreWithoutTheSidebar() {
        for tab in [MainTab.claims, .schedule, .profile, .settings] {
            let r = TabRouting.adapt(tab: tab, morePath: [], sidebar: false)
            #expect(r.tab == .more && r.morePath == [tab])
        }
    }

    @Test func tabBarTabsStayPut() {
        for tab in [MainTab.today, .leave, .pay, .inbox] {
            #expect(routes(tab: tab, morePath: [], sidebar: false, to: tab, []))
            #expect(routes(tab: tab, morePath: [], sidebar: true, to: tab, []))
        }
        // More at its root on a phone stays More.
        #expect(routes(tab: .more, morePath: [], sidebar: false, to: .more, []))
    }

    @Test func aScreenPushedUnderMoreBecomesItsSidebarTab() {
        #expect(routes(tab: .more, morePath: [.claims], sidebar: true, to: .claims, []))
        // Round trip: sidebar → compact → sidebar comes back to the same screen.
        let compact = TabRouting.adapt(tab: .settings, morePath: [], sidebar: false)
        #expect(routes(tab: compact.tab, morePath: compact.morePath, sidebar: true, to: .settings, []))
    }

    private func routes(tab: MainTab, morePath: [MainTab], sidebar: Bool, to expected: MainTab, _ path: [MainTab]) -> Bool {
        let r = TabRouting.adapt(tab: tab, morePath: morePath, sidebar: sidebar)
        return r.tab == expected && r.morePath == path
    }
}
