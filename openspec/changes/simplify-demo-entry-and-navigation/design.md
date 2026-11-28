## Context

The demo currently boots PGlite immediately, with language selection available on sign-in. Its banner exposes each demo tool as a separate button.

## Decisions

- Reuse the web locale store on the entry screen and defer worker startup until Start demo. Keep the user's current path, query and hash. Keep the start decision for the lifetime of the tab so working links and reloads open directly.
- Use one Demo options menu with switch-user, test-email, details and reset actions. Installation, documentation and the mobile-app demo are available from About this demo.
- Pass a demo-only Test emails action to the password reset UI through the existing shell presentation extension.
- Add a translated Reporting heading through the shared navigation groups.
