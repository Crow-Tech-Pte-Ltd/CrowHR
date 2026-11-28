## Purpose

Give visitors a clear entry point to the browser demo and make demo tools and reporting links easy to find.

## ADDED Requirements

### Requirement: Choose a language before boot
The demo SHALL display a language chooser and an explicit start action on the first app page loaded in a tab. It SHALL start its worker after the visitor chooses to continue and present the loader and app in the chosen language.

#### Scenario: Enter in Malay
- **WHEN** a visitor opens a new demo tab and selects Malay
- **THEN** the entry screen changes to Malay before the database starts
- **AND** selecting Start demo loads the requested app page in Malay

#### Scenario: Continue in the same tab
- **WHEN** the visitor reloads or follows a link in a tab where they have started the demo
- **THEN** the demo loads the destination using their saved language

### Requirement: Discover sandbox tools and reporting links
The demo SHALL place its sandbox tools under Demo options and explain what Test emails captures. Reports and Export data SHALL appear under a Reporting heading in the expanded sidebar and mobile drawer.

#### Scenario: Find a captured password reset email
- **WHEN** a demo visitor submits a password reset request
- **THEN** the result points to Test emails
- **AND** Test emails presents the captured message and explains that the demo does not send it

#### Scenario: Open reporting tools on mobile
- **WHEN** a visitor opens the mobile drawer
- **THEN** Reports and Export data appear in Reporting
