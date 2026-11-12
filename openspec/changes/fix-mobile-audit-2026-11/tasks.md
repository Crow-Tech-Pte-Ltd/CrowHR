## 1. iOS (apps/ios)

- [x] 1.1 apps/ios: a locked (unreadable) queue file is never written over, pruned or overtaken; a non-punch file is still set aside — `PunchQueueTests` (`aLockedPhoneNeverLosesOrReordersUnsentPunches`, `anUnreadableQueueFileIsNotAnEmptyQueue`, `noQueueFileIsAnEmptyQueue`, `aQueueFileThatIsNotPunchesIsSetAsideNotOverwritten`)
- [x] 1.2 apps/ios: the punch time is the tap's, before the location fix — `PunchQueueTests.thePunchTimeIsTheTapNotTheLocationFix`
- [x] 1.3 apps/ios: redirects are never followed; the recorder sees where answers came from — `RedirectTests`
- [x] 1.4 apps/ios: a rotated pair survives a refused Keychain save; an old session never deletes a later sign-in's tokens; a refresh after sign-out is dropped — `NativeAuthTests`
- [x] 1.5 apps/ios: photos are scaled and encoded once, off the main thread, upright — `ScreenLogicTests` (`photosAreScaledDownForUpload`, `libraryPhotosAreDecodedAtUploadSizeAndUpright`)
- [x] 1.6 apps/ios: shared ISO formatters; an empty inbox needs no extra request; marking one notification read updates the list in place — `FormattingTests`, `BackgroundRefreshTests`
- [x] 1.7 apps/ios: post-launch calls in parallel, punches reassigned only when changed, biometry read once, one `AuthSession` per connection — `SessionTests` and the user-flow UI tests

## 2. Android (apps/android)

- [x] 2.1 apps/android: values decrypted once per process, writes reach disk first, failures not remembered; key handle reused; files flushed before the rename — `EncryptedFileStoreTest`, device `KeystoreStorageTest`
- [x] 2.2 apps/android: the punch time is the tap's (location wait and permission dialog); the tap survives leaving the Clock tab — `PunchQueueTest` (`thePunchTimeIsTheTapNotTheLocationFix`, `aTapSurvivesBeingSavedAcrossThePermissionDialog`), device `EssJourneyTest.clockInOfflineIsQueuedThenSynced`
- [x] 2.3 apps/android: access token renewed a minute before expiry; older stored tokens still read — `NativeAuthTest`
- [x] 2.4 apps/android: tabs show their last content at once (memory only, cleared at session end) — `ScreenMemoryTest`, device `EssJourneyTest`
- [x] 2.5 apps/android: notifications cursor written once per load; marking one read updates the list in place — `NotificationPageTest`, device `EssJourneyTest.notificationsInbox`
- [x] 2.6 apps/android: leave quote ignores its own cancellation; Leave waits for the `/me` already under way; `Formats` regexes compiled once; payslip share folder cleared at session end — `FormatsTest`, `LeaveFormTest`, lint
- [x] 2.7 apps/android: the audit's finding 23 (one remembered `ScreenContext`) tried and reverted: with it the two journeys whose Done button pops back to the list failed on the emulator, and they pass without it

## Verification (13 Nov 2026)

- iOS: 122 unit tests (`CrowHRTests`) and the three user-flow UI tests (`EssJourneyUITests`, socket allow-list passed) on an iPhone 18 Pro simulator, iOS 27.0, Xcode 27.1.
- Android: 98 JVM unit tests, lint (0 errors) and the licence check; 21 device tests on `CrowHR_QA` (API 37) against the seeded test server. `leaveBalancesApplyAndHistory` failed once in the full run inside the test framework while closing the leave-type menu ("performMeasureAndLayout called during measure layout"), then passed twice on its own.

## 3. Owner decisions (not implemented)

- [ ] 3.1 packages/core: a grace window for retrying the latest refresh token (security review finding 23) — needs the owner's decision
- [ ] 3.2 apps/mobile-fixtures: treat a 4xx or 3xx punch answer without Crow HR's error body as temporary (`punch-queue-cases.json` `responses`, case `rej-nomsg`) — needs the owner's decision
