## Why
The web app had only a light theme (a non-goal of `add-foundation`), while the mobile apps, the docs site and the Crow Tech landing site all follow the device's dark setting. People who run their devices dark got a bright white page, and the demo looked unlike the docs it links to.

## What Changes
- Dark tokens ported from crow-tech-landing (`app/globals.css`, the `.docs-root.dark` set) into `packages/ui/src/styles/globals.css` under the same semantic names, swapped by `html.dark`. Components keep one set of classes; text on the yellow fills (primary button, active nav item, brand chip, selected tabs, unread count) uses `accent-foreground`, which stays dark in both themes.
- Two new tokens: `--shadow` (the hard offset shadow: ink in light, a light grey in dark, where an ink shadow would vanish) and `--overlay` (the modal backdrop, alpha included).
- A Theme choice in the account menu: System (default), Light, Dark, kept per browser in `localStorage` (`crowhr.theme`). `/theme.js` applies it before the first paint (CSP-safe, `script-src 'self'`), including on sign-in and setup pages and in the demo's boot screen. System follows the device live.
- Docs: "Light or dark" in Self-service.

## Capabilities
### Modified Capabilities
- `platform-foundation`: light and dark themes with a per-browser choice.

## Non-goals
- Theming payslip and letter PDFs (made on the server; they stay black on white).
- Storing the choice on the account (it is a per-device preference) or a high-contrast theme.
- Re-theming third-party sign-in buttons (Google, Microsoft and Singpass keep their own brand colours) and QR codes (they need a white quiet zone).

## Impact
`packages/ui` (tokens, preset, button, badge, dialog overlay), `apps/web` (account menu, theme hook, pre-paint script, a few yellow fills), `apps/demo` (pre-paint script, boot screen), docs.
