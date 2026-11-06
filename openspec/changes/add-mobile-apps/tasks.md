All tasks are milestone M4. Prerequisites: `add-api-platform` complete; attendance change (M2) provides idempotent punch validation.

## 1. Server-side support

- [x] 1.1 apps/web: write `e2e/mobile-qr.spec.ts` (My profile → Mobile app shows QR encoding `crowhr://connect?server=…&org=…`, no credentials in payload) then build the page — `apps/web/src/me/mobile-app-section.tsx` on My profile (also for members without an employee record; hidden in the demo), payload + QR in `me/mobile-connect.ts` (existing MIT `qrcode` encoder, in the browser, SVG); `/api/v1/me` gains `publicUrl` (additive); the e2e compares the QR image with the same encoder on the expected payload
- [x] 1.2 packages/core: write `notifications/since-cursor.http.test.ts` (`GET /api/v1/notifications?since=<cursor>` returns only newer items, stable cursor) then add the cursor if workflows did not ship it — `notifications/cursor.ts` (opaque base64url position over (created_at, id)); the list response gains `cursor` and the `since` filter (additive to the v1 snapshot); documented in apps/docs developers/api-conventions

## 2. Android (apps/android)

- [ ] 2.1 apps/android: project skeleton (Kotlin, Compose, pinned Gradle wrapper with checksum, stable AGP/Kotlin/Compose verified from official sources) — verified by `scripts/android-build.sh check` (debug build + unit tests + lint)
- [ ] 2.2 apps/android: write `ConnectViewModelTest` (meta parsing, HTTPS rule, private-range HTTP warning, incompatible server message, 5 saved connections) then implement connect + QR scan
- [ ] 2.3 apps/android: write `NativeAuthTest` (PKCE pair, state check, token storage encrypted with Keystore key, backup exclusion rules present) then implement Custom Tabs sign-in, refresh and biometric unlock
- [ ] 2.4 apps/android: write `PunchQueueTest` (FIFO, idempotency key reuse on retry, 200 cap, late-send label, never drops) then implement the queue and clock-in screen
- [ ] 2.5 apps/android: write Compose UI tests `EssJourneyTest` against the local seeded server (payslips, leave apply, claim with camera stub, schedule, approve/reject, notifications) with the network allow-list assertion, then implement the screens
- [ ] 2.6 apps/android: write `BackgroundRefreshTest` (WorkManager ≥ 15 min, content-free local notification) then implement
- [ ] 2.7 apps/android: QA at normal size, 200% font, dark mode, on a project-owned 16 KB-page emulator — verified by screenshots under `artifacts/android/` and a dependency audit for the Data safety form

## 3. iOS (apps/ios)

- [ ] 3.1 apps/ios: SwiftUI project skeleton synced to s5 via `scripts/ios-sync.sh` — verified by `xcodebuild test` on s5 (unit test target green)
- [ ] 3.2 apps/ios: write `ConnectTests` (same cases as 2.2) then implement connect + QR scan
- [ ] 3.3 apps/ios: write `NativeAuthTests` (ASWebAuthenticationSession callback handling, PKCE, Keychain this-device-only, no iCloud backup) then implement sign-in, refresh and biometric unlock
- [ ] 3.4 apps/ios: write `PunchQueueTests` (same cases as 2.4) then implement
- [ ] 3.5 apps/ios: write XCUITest `EssJourneyUITests` against the seeded server over SSH reverse tunnel with network allow-list assertion, then implement the screens
- [ ] 3.6 apps/ios: write `BackgroundRefreshTests` (BGAppRefreshTask scheduling, content-free local notification) then implement
- [ ] 3.7 apps/ios: QA with Dynamic Type XXXL, dark mode, VoiceOver labels — verified by simulator screenshots from xcresult (not mock-ups)

## 4. Release (requires Daniel's approval at each external step)

- [ ] 4.1 crow-tech-landing: `app/apps/crow-hr/privacy` and `support` pages (Data Not Collected model explained, out of global nav) — verified by site build + lint; publishing only after approval
- [ ] 4.2 scripts: release scripts that upload only to TestFlight internal / Play internal draft and refuse production without an approval flag — verified by a dry-run test of the refusal path
- [ ] 4.3 Store metadata, privacy label "Data Not Collected", Play Data safety from the dependency audit — verified by review; submission only after approval
