## 1. Tests first
- [x] 1.1 `apps/web`: System, Light and Dark resolve as specified; the demo ships the same pre-paint script and both pages load it in the head (`shell/theme.test.ts`).
- [x] 1.2 `e2e`: the account menu's choice is applied, kept after a reload and on another page, System follows the device, the sign-in page follows the saved theme, and axe is clean in both themes (`e2e/theme.spec.ts`).

## 2. Implementation
- [x] 2.1 `packages/ui`: dark tokens under `html.dark`, `--shadow` and `--overlay`, `accent-foreground` on yellow fills, `darkMode: "class"` in the preset (token contrast checked for every text and focus pair; `e2e/theme.spec.ts`).
- [x] 2.2 `apps/web` and `apps/demo`: `/theme.js` before the first paint, the account menu's Theme choice, the demo boot screen in dark (`shell/theme.test.ts`, `e2e/theme.spec.ts`, `bun run demo:e2e`).

## 3. Verification and documentation
- [x] 3.1 Every demo screen for five personas at 1440 and 390 px, light and dark, plus dialogs, sheets and menus, screenshotted and checked with axe-core.
- [x] 3.2 Docs: "Light or dark" in Self-service (docs build link check).
