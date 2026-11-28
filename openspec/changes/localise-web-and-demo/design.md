## Context

The self-hosted web app and static demo use the same routes and components. The demo also has its own loading screen, banner and information page.

## Goals

- Offer language selection before and after sign-in on desktop and mobile web.
- Use Singapore terminology, preserve context in messages with dynamic values, and make language changes visible to assistive technology.
- Keep the preference local to the browser and share it between the demo's UI roots.

## Decisions

- Store an explicit BCP 47 locale tag in browser storage. Use browser language preferences on the first visit and set the document language when the active locale changes.
- Use English source messages scoped by feature, with named placeholders that translations can reorder. Serve a pack per language with the web build and load only the active one. The demo uses the same static packs.
- Translate app-owned display copy at rendering boundaries. Render organisation names, configuration values, and statutory acronyms as supplied and keep Singapore time and SGD conventions.
- Present missing company profile details as an inline warning before the fields. Payroll continues to run its own separate validation for each run.

## Risks / Trade-offs

Independent catalogs need consistent vocabulary and complete placeholder sets. Automated catalog tests check parity and interpolation, and browser tests exercise preferences through sign-in, navigation and a form.
