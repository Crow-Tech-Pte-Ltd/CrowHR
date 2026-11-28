## ADDED Requirements

### Requirement: Company appearance

Crow HR SHALL support a company accent and logo without requiring a payroll profile.

#### Scenario: Brand a new installation

- **WHEN** the first owner supplies valid appearance settings during setup
- **THEN** the company sign-in page and signed-in app display the saved appearance

#### Scenario: Change or reset appearance

- **WHEN** the owner previews and saves or resets appearance in Company settings
- **THEN** the company’s appearance changes, and other organisations retain their own appearance

#### Scenario: Keep defaults

- **WHEN** an organisation has no custom appearance
- **THEN** the sign-in page and app display the default Crow HR appearance
