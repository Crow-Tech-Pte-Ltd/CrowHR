# Mobile shared fixtures

JSON test cases that **both** native apps (`apps/android`, `apps/ios`) run, so the two
platforms behave the same for the same input (`openspec/changes/add-mobile-apps`, design
"Goals": shared fixtures so both platforms test the same journeys).

Plain JSON, no comments, UTF-8. Every file has a top-level `"version": 1`. File names are
stable: add cases or files, never rename or remove. A change to an existing expectation
is a behaviour change on both platforms and needs a note in the change's tasks.

| File | What it covers | Used by |
| --- | --- | --- |
| `connect-cases.json` | Server address normalisation, the HTTPS rule and private-range HTTP warning, `/api/v1/meta` parsing, incompatible-server outcomes, feature gates per screen, user-facing messages, saved connections (max 5) | Android `ConnectViewModelTest`, iOS `ConnectTests` (tasks 2.2 / 3.2) |
| `deeplink-cases.json` | QR / link `crowhr://connect?server=…&org=…` parsing, the native sign-in callback `crowtech.crowhr:/oauth2redirect?code=…&state=…` (state check), the PKCE S256 vector and the authorise URL | Android `DeepLinkTest`, `NativeAuthTest`; iOS `ConnectTests`, `NativeAuthTests` (2.2, 2.3 / 3.2, 3.3) |
| `punch-queue-cases.json` | Offline clock-in queue: FIFO, idempotency key reuse on retry, 200 cap, late-send label, never drops; the exact request body and per-punch labels | Android `PunchQueueTest`, iOS `PunchQueueTests` (2.4 / 3.4) |
| `background-refresh-cases.json` | Background refresh: what counts as new, the content-free local notification text, cursor rules | Android `BackgroundRefreshTest`, iOS `BackgroundRefreshTests` (2.6 / 3.6) |
| `format-cases.json` | `S$1,234.56`, `31 Oct 2026`, Singapore time, NRIC/FIN masking (same as `packages/ui/src/lib/format.ts`) | both apps' formatter tests |
| `claim-money-cases.json` | The claim form's S$ preview for foreign-currency lines: amounts in minor units, rates in millionths, half-up once per line (same as `packages/core/src/claims/money.ts`), the rate warning's percentage; iOS also checks the currency list, the form's messages and the receipt rule on the S$ amount | Android `ClaimMoneyTest`, iOS `ClaimFormTests` |
| `notification-link-cases.json` | Where a notification's web `link` opens in the app, and the rule that a local notification for one new item opens that item; `items` lists what iOS also opens inside a screen (the approval task, the leave request) | Android `NotificationLinksTest`, iOS `NotificationTargetTests` |

## Conventions

- Instants are ISO 8601 in UTC (`2026-11-02T00:58:00Z`). Dates are `YYYY-MM-DD`.
- `null` means "absent / not applicable".
- Messages and labels in `messages` / `labels` are the exact user-facing English text;
  `{placeholders}` are filled in by the app.
- In `connect-cases.json`, `meta` is what the server answers for the meta request:
  `null` means no request is made; `{ "network": "unreachable" | "tls_error" }` is a
  transport failure; otherwise `status`, `contentType` and `body` (JSON value, or a string
  sent as is).
- In `punch-queue-cases.json`, each case starts from an empty queue. A `drain` consumes its
  `responses` in order, one per request; `expect.requests` lists every request made in that
  drain. Keys are given by the case so results are deterministic; the apps generate UUIDs.
- In `deeplink-cases.json`, `expectedState: null` means the app has no sign-in in progress.

## How the apps load them

- Android: `apps/android/app/build.gradle.kts` adds this directory to the unit-test
  resources, so tests read e.g. `connect-cases.json` from the classpath.
- iOS: the test target copies this directory as a resource bundle (see `apps/ios`).
