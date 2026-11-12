## 1. Organisation switcher
- [x] 1.1 `packages/core` auth: `GET /me/organisations` lists active and former memberships only, current marked, never another person's (`auth/my-organisations.http.test.ts`).
- [x] 1.2 `apps/web` shell: switcher lists and switches, reloads; single-organisation note; axe-clean menu (`e2e/org-switcher.spec.ts`).

## 2. Company logo
- [x] 2.1 `apps/web` settings/company: upload with PNG and size checks, preview (`e2e/org-switcher.spec.ts`, axe at 1440 and 360 px).

## 3. Documents
- [x] 3.1 `packages/core` documents: opt-in `page`/`pageSize`, `total`, stable order, visibility-aware counts (`documents/pagination.http.test.ts`).
- [x] 3.2 `apps/web` documents: Expiring, Deleted and the employee tab page by 25 (`e2e/ws6b/documents.ws6b.ts`).

## 4. People
- [x] 4.1 `apps/web` people: under-16 conditions in the hire form (`people/-lib/age.test.ts`, `e2e/people/people.people.ts`).
- [x] 4.2 `packages/core` import: `workman` and `manager_or_executive` columns (`employees/import/import.http.test.ts`).

## 5. Documentation
- [x] 5.1 FAQ, company, hire, import guides, status and limitations (docs build link check).
