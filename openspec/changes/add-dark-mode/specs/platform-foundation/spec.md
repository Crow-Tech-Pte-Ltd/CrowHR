## ADDED Requirements
### Requirement: Light and dark themes
The web app and the in-browser demo SHALL offer a light and a dark theme built from the same semantic tokens, so every screen, dialog, sheet, menu, table, status chip, chart and focus ring has both. Each person SHALL be able to choose System, Light or Dark in the account menu; the choice SHALL be kept in that browser, SHALL default to System (the device's setting) and SHALL apply before the first paint. Both themes SHALL meet WCAG 2.1 AA contrast. Payslip and letter PDFs SHALL NOT change with the theme.

#### Scenario: System follows the device
- **WHEN** a member who never chose a theme opens Crow HR on a device set to dark
- **THEN** the app is dark, and it turns light when the device does

#### Scenario: A choice is kept in this browser
- **WHEN** Siti picks Theme → Light in the account menu and reloads
- **THEN** the app stays light in that browser, including the sign-in page, whatever the device's setting

#### Scenario: Both themes pass axe
- **WHEN** axe-core checks a screen in the light and the dark theme
- **THEN** neither has a colour-contrast violation
