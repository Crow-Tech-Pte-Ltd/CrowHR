## Purpose

Give Crow HR users a choice of interface language across the self-hosted web app and the browser demo.

## ADDED Requirements

### Requirement: Browser language preference
The web app and public demo SHALL offer English, Simplified Chinese, Malay and Tamil on their public entry screens and in the signed-in account menu. The browser's supported language preference SHALL be used initially, with English as the default when none match. An explicit selection SHALL take effect on the current screen and be saved in that browser.

#### Scenario: Switch before signing in
- **WHEN** a visitor chooses Tamil on the sign-in screen
- **THEN** the screen and its accessible controls use Tamil and the page declares Tamil as its language
- **AND** the preference is retained on reload and after signing in

#### Scenario: Switch in the public demo
- **WHEN** a signed-in demo visitor chooses Malay from the account menu
- **THEN** the navigation and translated page copy switch to Malay without a fresh demo database or a new sign-in

### Requirement: Localised interface copy
The web app SHALL use the selected language for translated interface copy, with English as a fallback for messages without a translation. The language preference SHALL apply to presentation while preserving organisation-entered values and statutory identifiers.

#### Scenario: Read a localised employee record
- **WHEN** an authorised member opens an employee record in Simplified Chinese
- **THEN** the translated record labels appear in Simplified Chinese
- **AND** the employee's name and identifiers keep their stored values

### Requirement: Company profile setup guidance
The Company settings screen SHALL explain which required details are missing if the saved profile is incomplete. A complete company profile SHALL not render a payroll status in the page header.

#### Scenario: Saved company profile missing a CSN
- **WHEN** a member opens Company settings with the CPF Submission Number missing
- **THEN** the form identifies that field as needed to finalise payroll

#### Scenario: Company profile complete
- **WHEN** the legal entity details and registered address required for payroll are present
- **THEN** Company settings shows the profile with no payroll status in the header
