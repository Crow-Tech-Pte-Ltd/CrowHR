## ADDED Requirements
### Requirement: Organisation switcher
The system SHALL list, for the signed-in person, the organisations where they have an active or former membership, by name, with the current one marked, and SHALL NOT list suspended or invited memberships or another person's organisations. Choosing one in the web app SHALL move the browser session to it through `POST /auth/switch-organisation` and reload the app.

#### Scenario: Member of two companies
- **WHEN** Ravi, a member of Kampong Kopi and Kampong Kopi Catering, opens the switcher
- **THEN** both are listed with Kampong Kopi marked current, and choosing Catering reloads the app signed in to Catering
