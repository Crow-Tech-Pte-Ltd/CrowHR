## Why
Several features worked through the API but had no control in the web app, or showed less than the server knew: switching organisation, uploading the company logo, paging the document lists, the under-16 conditions on a hire, and the Part 4 flags in the CSV import.

## What Changes
- **Organisation switcher**: `GET /me/organisations` (additive) lists the organisations where the person is an active or former member; the switcher lists them and moves the session with `POST /auth/switch-organisation`, then reloads the app.
- **Company logo**: an upload control on Settings → Company (PNG, at most 1 MB, checked in the browser and on the server), with a preview.
- **Document lists page**: `GET /documents` takes optional `page` and `pageSize` and always returns `total`; without them it returns every document as in 1.0. Expiring, Deleted and each employee's Documents tab page by 25.
- **Hire form**: the Employment Act conditions for someone under 16 on the start date (light duties; MOM notification for industrial work; no night work), from the same sg-rules check the server runs.
- **CSV import**: optional `workman` and `manager_or_executive` columns (template version 2; version 1 files still import).

## Capabilities
### Modified Capabilities
- `auth`: list my organisations for the switcher.
- `organisation`: logo upload in the web app.
- `documents`: paged lists.
- `employees`: young-hire conditions in the hire form; Part 4 flags in the import.

## Non-goals
- Adding organisations from the switcher.
- Tracking young workers' hours or MOM notifications.
- Paging an employee's own My documents list (it stays whole so acknowledgements are never missed).

## Impact
`packages/core` auth, documents and import; `apps/web` shell, company, documents, hire form; e2e seed (a sister organisation); docs and limitations.
