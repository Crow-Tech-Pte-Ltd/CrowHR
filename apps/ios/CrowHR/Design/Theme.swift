import SwiftUI
import UIKit

/// Crow Tech tokens (packages/ui/src/styles/globals.css), as exact sRGB values. Dark mode is an
/// app-side inversion: ink surfaces, near-white text, the same kuning accent.
enum Crow {
    private static func rgb(_ hex: UInt32) -> UIColor {
        UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }

    static func dynamicUI(_ light: UInt32, _ dark: UInt32) -> UIColor {
        UIColor { $0.userInterfaceStyle == .dark ? rgb(dark) : rgb(light) }
    }

    private static func dynamic(_ light: UInt32, _ dark: UInt32) -> Color { Color(uiColor: dynamicUI(light, dark)) }

    // Surfaces
    static let background = dynamic(0xFFFFFF, 0x0A0A0A) // surface-50 / ink
    static let surface = dynamic(0xFFFFFF, 0x141414) // cards
    static let surfaceMuted = dynamic(0xEBEDEF, 0x1F1F1F) // surface-200
    static let surfaceWarm = dynamic(0xFDF6E8, 0x1A1712) // surface-100
    // Text
    static let ink = dynamic(0x0A0A0A, 0xF5F5F5) // --ink / --foreground
    static let muted = dynamic(0x666666, 0xA3A3A3) // --muted-foreground (AA on white)
    static let hairline = dynamic(0xDEDEDE, 0x2E2E2E) // --border
    static let strongBorder = dynamic(0x0A0A0A, 0xF5F5F5)
    // Accents
    static let kuning = Color(uiColor: rgb(0xFED56C)) // kuning-200, --accent
    static let kuningSoft = dynamic(0xFFF2CC, 0x3A2F10) // kuning-50
    static let onKuning = Color(uiColor: rgb(0x0A0A0A)) // yellow needs dark text in both modes
    static let biru = dynamic(0x1C5EE3, 0x6796F4) // biru-400 / biru-200: links and focus
    // Status
    static let success = dynamic(0x0C6A52, 0x70D86E)
    static let successSoft = dynamic(0xD7F4D7, 0x13301A)
    static let warning = dynamic(0xA6630C, 0xF1B055)
    static let warningSoft = dynamic(0xFDF3E2, 0x3A2A10)
    static let danger = dynamic(0xA82424, 0xE07171)
    static let dangerSoft = dynamic(0xFCE8E8, 0x3A1515)

    static let radius: CGFloat = 8
    /// Buttons, like the web kit's `rounded-md` (6 px); cards and sheets use `radius`.
    static let buttonRadius: CGFloat = 6
}

/// Azeret Mono for headings, labels and all numbers; Ubuntu for body text. Both scale with
/// Dynamic Type through `relativeTo:`.
enum CrowFont {
    static func size(for style: Font.TextStyle) -> CGFloat {
        switch style {
        case .largeTitle: 34
        case .title: 28
        case .title2: 22
        case .title3: 20
        case .headline, .body: 17
        case .callout: 16
        case .subheadline: 15
        case .footnote: 13
        case .caption: 12
        case .caption2: 11
        default: 17
        }
    }

    static func body(_ style: Font.TextStyle = .body, weight: Font.Weight = .regular) -> Font {
        let name = switch weight {
        case .bold, .heavy, .black, .semibold: "Ubuntu-Bold"
        case .medium: "Ubuntu-Medium"
        default: "Ubuntu-Regular"
        }
        return .custom(name, size: size(for: style), relativeTo: style)
    }

    static func mono(_ style: Font.TextStyle = .body, weight: Font.Weight = .regular) -> Font {
        let name = switch weight {
        case .bold, .heavy, .black, .semibold: "AzeretMono-SemiBold"
        case .medium: "AzeretMono-Medium"
        default: "AzeretMono-Regular"
        }
        return Font.custom(name, size: size(for: style), relativeTo: style).monospacedDigit()
    }

    static func uiMono(_ style: UIFont.TextStyle, size: CGFloat, weight: String = "AzeretMono-SemiBold") -> UIFont {
        let base = UIFont(name: weight, size: size) ?? .monospacedSystemFont(ofSize: size, weight: .semibold)
        return UIFontMetrics(forTextStyle: style).scaledFont(for: base)
    }

    static let fontNames = ["AzeretMono-Regular", "AzeretMono-Medium", "AzeretMono-SemiBold", "Ubuntu-Regular", "Ubuntu-Medium", "Ubuntu-Bold"]
}

enum CrowAppearance {
    /// Navigation titles in Azeret Mono; hairline bottom edge, no blur shadow.
    @MainActor static func apply() {
        let nav = UINavigationBarAppearance()
        nav.configureWithOpaqueBackground()
        nav.backgroundColor = Crow.dynamicUI(0xFFFFFF, 0x0A0A0A)
        nav.shadowColor = Crow.dynamicUI(0xDEDEDE, 0x2E2E2E)
        // The system label colour: a custom dynamic colour in large-title attributes resolved to the
        // dark-mode value in light mode (invisible title on Today and Leave).
        let ink = UIColor.label
        nav.titleTextAttributes = [.font: CrowFont.uiMono(.headline, size: 17), .foregroundColor: ink]
        nav.largeTitleTextAttributes = [.font: CrowFont.uiMono(.largeTitle, size: 30), .foregroundColor: ink]
        UINavigationBar.appearance().standardAppearance = nav
        UINavigationBar.appearance().compactAppearance = nav
        UINavigationBar.appearance().scrollEdgeAppearance = nav

        let tab = UITabBarAppearance()
        tab.configureWithOpaqueBackground()
        tab.backgroundColor = Crow.dynamicUI(0xFFFFFF, 0x0A0A0A)
        tab.shadowColor = Crow.dynamicUI(0xDEDEDE, 0x2E2E2E)
        UITabBar.appearance().standardAppearance = tab
        UITabBar.appearance().scrollEdgeAppearance = tab
    }
}

// MARK: - Buttons

/// The primary action: kuning fill, 2px ink border and the hard offset shadow (reserved for
/// emphasis per the design language). No blur, no gradient.
struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        let offset: CGFloat = configuration.isPressed || !isEnabled ? 0 : 3
        let shape = RoundedRectangle(cornerRadius: Crow.buttonRadius)
        configuration.label
            .font(CrowFont.mono(.callout, weight: .semibold))
            .foregroundStyle(Crow.onKuning)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, minHeight: 50)
            .padding(.horizontal, 16)
            .background(shape.fill(isEnabled ? Crow.kuning : Crow.surfaceMuted))
            .overlay(shape.strokeBorder(Color(uiColor: Crow.dynamicUI(0x0A0A0A, 0x0A0A0A)), lineWidth: 2))
            .background(shape.fill(Crow.strongBorder).offset(x: offset, y: offset))
            .offset(x: configuration.isPressed ? 3 : 0, y: configuration.isPressed ? 3 : 0)
            .opacity(isEnabled ? 1 : 0.6)
            .contentShape(shape)
    }
}

struct SecondaryButtonStyle: ButtonStyle {
    var tone: Color = Crow.ink

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(CrowFont.mono(.callout, weight: .medium))
            .foregroundStyle(tone)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, minHeight: 46)
            .padding(.horizontal, 16)
            .background(configuration.isPressed ? Crow.surfaceMuted : Crow.surface)
            .overlay(RoundedRectangle(cornerRadius: Crow.buttonRadius).strokeBorder(Crow.hairline, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: Crow.buttonRadius))
            .contentShape(RoundedRectangle(cornerRadius: Crow.buttonRadius))
    }
}

extension ButtonStyle where Self == PrimaryButtonStyle {
    static var crowPrimary: PrimaryButtonStyle { PrimaryButtonStyle() }
}

extension ButtonStyle where Self == SecondaryButtonStyle {
    static var crowSecondary: SecondaryButtonStyle { SecondaryButtonStyle() }
    static var crowDanger: SecondaryButtonStyle { SecondaryButtonStyle(tone: Crow.danger) }
}

// MARK: - Building blocks

struct CardModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Crow.surface)
            .overlay(RoundedRectangle(cornerRadius: Crow.radius).strokeBorder(Crow.hairline, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: Crow.radius))
    }
}

extension View {
    func crowCard() -> some View { modifier(CardModifier()) }

    /// Screen background used everywhere.
    func crowScreen() -> some View {
        self.background(Crow.background.ignoresSafeArea())
            .scrollContentBackground(.hidden)
    }
}

/// Mono label above a group ("LEAVE BALANCES").
struct SectionLabel: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text.uppercased())
            .font(CrowFont.mono(.caption, weight: .medium))
            .tracking(0.6)
            .foregroundStyle(Crow.muted)
            .accessibilityAddTraits(.isHeader)
    }
}

enum Tone { case neutral, success, warning, danger, accent }

struct StatusChip: View {
    let text: String
    let tone: Tone
    var body: some View {
        Text(text)
            .font(CrowFont.mono(.caption, weight: .medium))
            .foregroundStyle(fg)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(bg)
            .clipShape(RoundedRectangle(cornerRadius: 4))
            .fixedSize(horizontal: false, vertical: true)
    }

    private var fg: Color {
        switch tone {
        case .neutral: Crow.ink
        case .success: Crow.success
        case .warning: Crow.warning
        case .danger: Crow.danger
        case .accent: Crow.onKuning
        }
    }

    private var bg: Color {
        switch tone {
        case .neutral: Crow.surfaceMuted
        case .success: Crow.successSoft
        case .warning: Crow.warningSoft
        case .danger: Crow.dangerSoft
        case .accent: Crow.kuning
        }
    }
}

/// `S$1,234.56` in Azeret Mono with tabular figures, read aloud in words.
struct MoneyText: View {
    let cents: Int
    var style: Font.TextStyle = .body
    var weight: Font.Weight = .regular
    var body: some View {
        Text(Fmt.money(cents: cents))
            .font(CrowFont.mono(style, weight: weight))
            .foregroundStyle(Crow.ink)
            .accessibilityLabel(Fmt.moneySpoken(cents: cents))
    }
}

/// Label and value side by side, stacked at accessibility text sizes so nothing breaks
/// mid-word or truncates (spec: text scales to 200% without truncating).
struct AdaptiveRow<Leading: View, Trailing: View>: View {
    @Environment(\.dynamicTypeSize) private var size
    @ViewBuilder let leading: () -> Leading
    @ViewBuilder let trailing: () -> Trailing

    var body: some View {
        if size.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 4) {
                leading()
                trailing()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                // The label wraps; the value (an amount, a balance, a status) never compresses.
                leading()
                    .frame(maxWidth: .infinity, alignment: .leading)
                trailing()
                    .fixedSize()
            }
        }
    }
}

/// A single choice from a list. A menu picker at normal sizes. At accessibility sizes, an
/// app-drawn row opens its own list: the system picker's label and value don't fully scale there.
struct ChoiceField: View {
    @Environment(\.dynamicTypeSize) private var size
    let title: String
    let options: [(id: String, name: String)]
    @Binding var selection: String
    @State private var choosing = false

    var body: some View {
        if size.isAccessibilitySize {
            Button { choosing = true } label: {
                HStack(spacing: 8) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(title).font(CrowFont.body()).foregroundStyle(Crow.muted)
                            .fixedSize(horizontal: false, vertical: true)
                        Text(options.first { $0.id == selection }?.name ?? "Choose")
                            .font(CrowFont.body(.body, weight: .medium)).foregroundStyle(Crow.ink)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: "chevron.right").foregroundStyle(Crow.muted).accessibilityHidden(true)
                }
            }
            .navigationDestination(isPresented: $choosing) {
                List(options, id: \.id) { option in
                    Button {
                        selection = option.id
                        choosing = false
                    } label: {
                        HStack {
                            Text(option.name).font(CrowFont.body()).foregroundStyle(Crow.ink)
                                .fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: 8)
                            if option.id == selection { Image(systemName: "checkmark").foregroundStyle(Crow.ink) }
                        }
                    }
                    .accessibilityAddTraits(option.id == selection ? .isSelected : [])
                }
                .navigationTitle(title)
            }
        } else {
            Picker(title, selection: $selection) {
                ForEach(options, id: \.id) { Text($0.name).tag($0.id) }
            }
            .pickerStyle(.menu)
        }
    }
}

/// A notice block (info, warning, error) with an icon and text that wraps.
struct Notice: View {
    let text: String
    var tone: Tone = .neutral
    var systemImage: String = "info.circle"
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: systemImage).accessibilityHidden(true)
            Text(text).font(CrowFont.body(.subheadline)).fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(tone == .danger ? Crow.danger : tone == .warning ? Crow.warning : Crow.ink)
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tone == .danger ? Crow.dangerSoft : tone == .warning ? Crow.warningSoft : Crow.surfaceMuted)
        .clipShape(RoundedRectangle(cornerRadius: Crow.radius))
        .accessibilityElement(children: .combine)
    }
}
