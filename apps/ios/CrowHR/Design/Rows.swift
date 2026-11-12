import SwiftUI

// Lists and forms without SwiftUI `List` or `Form` (task 3.7).
//
// Xcode's accessibility audit reports Dynamic Type "partially unsupported", and at the largest
// sizes "text clipped", for text inside `List` and `Form` cells, although the text scales. The
// same rows in a `ScrollView` audit clean (A11yAuditLabUITests; Apple DTS: the audit looks for
// UIKit's `adjustsFontForContentSizeCategory`, which SwiftUI's list cells don't always expose).
// So every screen is a `ScrollView` of plain rows built from these pieces. Lists here are at most
// one API page (50 rows), so a plain `VStack` keeps every row in the accessibility tree for
// VoiceOver and UI tests.

/// A scrolling screen of row groups on the screen background, edge to edge like a plain list.
struct RowsScreen<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) { content() }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.bottom, 24)
        }
        .scrollDismissesKeyboard(.interactively)
        .crowScreen()
    }
}

extension View {
    /// The inset of a row in a `RowGroup`: the same 16 pt edges as a plain list.
    func crowRowPadding(vertical: CGFloat = 12) -> some View {
        padding(.horizontal, 16)
            .padding(.vertical, vertical)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A section of rows: an optional mono header, hairline dividers between and under the rows, and
/// an optional footnote. Rows pad themselves (`crowRowPadding`, or `RowButtonStyle` for rows that
/// are buttons) so a pressed row highlights edge to edge.
struct RowGroup<Content: View>: View {
    var header: String? = nil
    var footer: String? = nil
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let header {
                SectionLabel(header)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 16)
                    .padding(.top, 20)
                    .padding(.bottom, 4)
            }
            Group(subviews: content()) { rows in
                ForEach(rows) { row in
                    row
                    Divider().overlay(Crow.hairline).padding(.horizontal, 16)
                }
            }
            if let footer {
                Text(footer)
                    .font(CrowFont.body(.footnote))
                    .foregroundStyle(Crow.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
            }
        }
    }
}

/// A row that is a button or a navigation link: full-width tap target, a muted highlight while
/// pressed, and a chevron (navigation) or an arrow (leaves the app) that VoiceOver doesn't read.
/// At accessibility text sizes the chevron or arrow is left out, so long words keep the row's
/// full width instead of breaking mid-word; the row is still a button.
struct RowButtonStyle: ButtonStyle {
    enum Accessory { case none, chevron, external }
    var accessory: Accessory = .none
    @Environment(\.dynamicTypeSize) private var size

    func makeBody(configuration: Configuration) -> some View {
        HStack(alignment: .center, spacing: 10) {
            configuration.label
                .frame(maxWidth: .infinity, alignment: .leading)
            if accessory != .none && !size.isAccessibilitySize {
                Image(systemName: accessory == .chevron ? "chevron.right" : "arrow.up.right")
                    .font(CrowFont.body(.footnote, weight: .medium))
                    .foregroundStyle(Crow.muted)
                    .accessibilityHidden(true)
            }
        }
        .crowRowPadding()
        .contentShape(Rectangle())
        .background(configuration.isPressed ? Crow.surfaceMuted : Color.clear)
    }
}

extension ButtonStyle where Self == RowButtonStyle {
    static var crowRow: RowButtonStyle { RowButtonStyle() }
    static var crowNavigationRow: RowButtonStyle { RowButtonStyle(accessory: .chevron) }
}

/// A small bordered button for an action on one row (withdraw, cancel, remove). 44 pt tall.
struct CompactButtonStyle: ButtonStyle {
    var tone: Color = Crow.ink

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(CrowFont.mono(.footnote, weight: .medium))
            .foregroundStyle(tone)
            .multilineTextAlignment(.leading)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .frame(minHeight: 44)
            .background(RoundedRectangle(cornerRadius: Crow.buttonRadius).fill(configuration.isPressed ? Crow.surfaceMuted : Crow.surface))
            .overlay(RoundedRectangle(cornerRadius: Crow.buttonRadius).strokeBorder(Crow.hairline, lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: Crow.buttonRadius))
    }
}

extension ButtonStyle where Self == CompactButtonStyle {
    static var crowCompact: CompactButtonStyle { CompactButtonStyle() }
    static var crowCompactDanger: CompactButtonStyle { CompactButtonStyle(tone: Crow.danger) }
}

/// A read-only label and value. Side by side (the value wraps, right-aligned); stacked at
/// accessibility text sizes. One VoiceOver element.
struct InfoRow: View {
    @Environment(\.dynamicTypeSize) private var size
    let label: String
    let value: String
    var mono = false
    /// What VoiceOver says for the value when the text reads badly aloud (a masked NRIC). On the
    /// combined row, which audits clean (a label on the `Text` itself is reported as clipped).
    var spoken: String? = nil

    init(_ label: String, _ value: String, mono: Bool = false, spoken: String? = nil) {
        self.label = label
        self.value = value
        self.mono = mono
        self.spoken = spoken
    }

    var body: some View {
        let title = Text(label).font(CrowFont.body(.subheadline)).foregroundStyle(Crow.muted)
        let detail = Text(value).font(mono ? CrowFont.mono(.body) : CrowFont.body()).foregroundStyle(Crow.ink)
        Group {
            if size.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 2) {
                    title.fixedSize(horizontal: false, vertical: true)
                    detail.fixedSize(horizontal: false, vertical: true)
                }
            } else {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    title.layoutPriority(1)
                    Spacer(minLength: 0)
                    detail.multilineTextAlignment(.trailing).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .crowRowPadding()
        .accessibilityElement(children: .combine)
        .modifier(SpokenLabel(text: spoken.map { "\(label), \($0)" }))
    }
}

/// A VoiceOver label only when there is one (an empty label would silence the element).
private struct SpokenLabel: ViewModifier {
    let text: String?
    func body(content: Content) -> some View {
        if let text { content.accessibilityLabel(text) } else { content }
    }
}

/// `S$1,234.56` in Azeret Mono with tabular figures. VoiceOver reads amounts in words, but a
/// `Text` whose label differs from its text is flagged by the audit as "may be clipped at larger
/// sizes" (`MoneyText` is). So: inside a row combined into one VoiceOver element, the row's own
/// label carries `Fmt.moneySpoken` (`spoken: false` here); an amount on its own (`spoken: true`)
/// keeps the spoken label on a text that grows vertically, which audits clean.
struct AmountText: View {
    let cents: Int
    var style: Font.TextStyle = .body
    var weight: Font.Weight = .regular
    var spoken = false

    var body: some View {
        let text = Text(Fmt.money(cents: cents))
            .font(CrowFont.mono(style, weight: weight))
            .foregroundStyle(Crow.ink)
        if spoken {
            text.fixedSize(horizontal: false, vertical: true)
                .accessibilityLabel(Fmt.moneySpoken(cents: cents))
        } else {
            text
        }
    }
}

// MARK: - Form fields

extension View {
    /// The input box of a form field: hairline border, 2 pt biru while focused, danger when invalid.
    func crowFieldBox(focused: Bool = false, invalid: Bool = false) -> some View {
        let shape = RoundedRectangle(cornerRadius: Crow.radius)
        return padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(shape.fill(Crow.surface))
            .overlay(shape.strokeBorder(invalid ? Crow.danger : focused ? Crow.biru : Crow.hairline, lineWidth: focused || invalid ? 2 : 1))
            .contentShape(shape)
    }
}

extension View {
    /// A date picker in Singapore time on the Gregorian calendar, `31 Oct 2026`: the day picked
    /// is the day sent (`Fmt.day`). In the phone's own time zone, a phone set to London or New
    /// York showed one day and sent the next or the previous one.
    func singaporeDates() -> some View {
        environment(\.timeZone, Fmt.singapore)
            .environment(\.calendar, Fmt.calendar)
            .environment(\.locale, Locale(identifier: "en_SG"))
    }
}

extension View {
    /// For a one-line value in a `TextField(axis: .vertical)`, which wraps so a long value or
    /// placeholder stays whole at large text sizes (a one-line field clips it): Return doesn't
    /// start a new line, it runs `onReturn` (next field, close the keyboard, continue). A pasted
    /// line break is dropped the same way.
    func returnEndsField(_ text: Binding<String>, onReturn: @escaping () -> Void) -> some View {
        onChange(of: text.wrappedValue) { _, value in
            guard value.contains(where: \.isNewline) else { return }
            text.wrappedValue = value.filter { !$0.isNewline }
            onReturn()
        }
    }
}

/// A form field: a mono label above its control. The control carries the same label for
/// VoiceOver and Voice Control, so the visible one isn't read twice.
struct FormField<Content: View>: View {
    let label: String
    @ViewBuilder let content: () -> Content

    init(_ label: String, @ViewBuilder content: @escaping () -> Content) {
        self.label = label
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionLabel(label)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityHidden(true)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One choice from a list, as a form field. A menu at normal text sizes; at accessibility sizes
/// the field opens a full-screen list of the options instead, so long names wrap rather than
/// truncate. VoiceOver reads the field's title and the chosen option.
struct ChoiceRow: View {
    @Environment(\.dynamicTypeSize) private var size
    let title: String
    let options: [(id: String, name: String)]
    @Binding var selection: String
    var identifier: String? = nil
    /// Shown until something is chosen ("Choose the child").
    var placeholder = "Choose"
    /// What the field shows for the chosen option, when shorter than its name in the list (a
    /// currency's code: "MYR" for "MYR · Malaysian ringgit").
    var shown: ((String) -> String)? = nil
    @State private var choosing = false

    private var chosen: String {
        guard let option = options.first(where: { $0.id == selection }) else { return placeholder }
        return shown?(option.id) ?? option.name
    }

    var body: some View {
        Group {
            if size.isAccessibilitySize {
                // The whole field is the button. The chevron sits beside the title, so the chosen
                // name gets the box's full width and long words don't break mid-word.
                Button { choosing = true } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            SectionLabel(title).fixedSize(horizontal: false, vertical: true)
                            chevron("chevron.right")
                        }
                        valueText.crowFieldBox()
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(title)
                .accessibilityValue(chosen)
                .accessibilityIdentifier(identifier ?? "")
            } else {
                FormField(title) {
                    Menu {
                        Picker(title, selection: $selection) {
                            ForEach(options, id: \.id) { Text($0.name).tag($0.id) }
                        }
                    } label: {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            valueText
                            chevron("chevron.up.chevron.down")
                        }
                        .crowFieldBox()
                    }
                    .tint(Crow.ink)
                    .accessibilityLabel(title)
                    .accessibilityValue(chosen)
                    .accessibilityIdentifier(identifier ?? "")
                }
            }
        }
        // Outside the size branch: the open list stays open if the text size changes meanwhile.
        .navigationDestination(isPresented: $choosing) { optionList }
    }

    private var valueText: some View {
        Text(chosen)
            .font(CrowFont.body(.body, weight: .medium))
            .foregroundStyle(Crow.ink)
            .multilineTextAlignment(.leading)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func chevron(_ name: String) -> some View {
        Image(systemName: name)
            .font(CrowFont.body(.footnote, weight: .medium))
            .foregroundStyle(Crow.muted)
            .accessibilityHidden(true)
    }

    private var optionList: some View {
        RowsScreen {
            RowGroup {
                ForEach(options, id: \.id) { option in
                    Button {
                        selection = option.id
                        choosing = false
                    } label: {
                        // The checkmark goes under the name at accessibility sizes, so the name
                        // keeps the full width ("Client entertainment" broke mid-word beside it).
                        AdaptiveRow {
                            Text(option.name).font(CrowFont.body()).foregroundStyle(Crow.ink)
                                .fixedSize(horizontal: false, vertical: true)
                        } trailing: {
                            if option.id == selection {
                                Image(systemName: "checkmark").foregroundStyle(Crow.ink).accessibilityHidden(true)
                            }
                        }
                    }
                    .buttonStyle(.crowRow)
                    .accessibilityAddTraits(option.id == selection ? .isSelected : [])
                    .accessibilityIdentifier("choice.option")
                }
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Two or three exclusive options drawn by the app (the system segmented control keeps a fixed
/// text size): side by side, stacked at accessibility sizes. Names are in Ubuntu, narrower than
/// Azeret Mono, so "Notifications" fits whole even at the largest size. (Not `ViewThatFits`: its
/// unused side-by-side copy got "text may be clipped" from Xcode's audit.) The chosen one is kuning;
/// VoiceOver reads it as selected.
struct SegmentedChoice<ID: Hashable>: View {
    @Environment(\.dynamicTypeSize) private var size
    let title: String
    let options: [(id: ID, name: String)]
    @Binding var selection: ID

    var body: some View {
        let layout = size.isAccessibilitySize ? AnyLayout(VStackLayout(spacing: 8)) : AnyLayout(HStackLayout(spacing: 8))
        layout { segments }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(title)
    }

    private var segments: some View {
        ForEach(options, id: \.id) { option in
            let on = option.id == selection
            let shape = RoundedRectangle(cornerRadius: Crow.buttonRadius)
            Button { selection = option.id } label: {
                Text(option.name)
                    .font(CrowFont.body(.subheadline, weight: on ? .bold : .medium))
                    .foregroundStyle(on ? Crow.onKuning : Crow.ink)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(shape.fill(on ? Crow.kuning : Crow.surface))
                    .overlay(shape.strokeBorder(on ? Crow.onKuning : Crow.hairline, lineWidth: 1))
                    .contentShape(shape)
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(on ? .isSelected : [])
        }
    }
}
