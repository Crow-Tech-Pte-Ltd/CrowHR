## Why

A code audit of both mobile apps (13 Nov 2026) found ways to lose or mis-time clock-ins and some avoidable slowness. Punches are attendance evidence, so the queue must never lose, duplicate or re-time one:

- iOS can start the app in the background while the phone is locked. The punch queue file (`NSFileProtectionComplete`) can't be read then, was taken for an empty queue, and the next tap wrote over the unsent punches.
- Both apps took the punch time after the location fix (up to 8 to 10 s after the tap, plus the permission dialog on Android). Android also dropped a tap, or left it unsent, when the user left the Clock tab during the wait.
- The iOS HTTP client followed redirects to any host. Android refuses them.
- Android decrypted every stored value through the Keystore on each read, mostly on the main thread, and showed the full-screen spinner again on every tab switch.

## What Changes

- **Punch queue (iOS):** a queue file that exists but can't be read is not an empty queue. Nothing is written or sent until it has been read; it is read again on every use; taps made meanwhile follow the stored punches. A file that reads but isn't punches is still set aside.
- **Tap time (both):** the device time and monotonic reading are taken at the tap, before any location wait or permission dialog.
- **Android tap lifetime:** the location wait, the save and the send run in the app's scope, and WorkManager is asked to send as soon as the punch is saved.
- **Redirects (iOS):** never followed, as on Android; a 3xx is an answer, not a session end. The UI-test recorder also records where each answer came from.
- **Tokens (iOS):** a rotated pair is kept when the Keychain refuses it and saved later; an old session never signs out, or deletes the tokens of, the one in use.
- **Android speed:** values are decrypted once per process (the files stay encrypted, memory is cleared on sign-out), the Keystore key handle is reused, files are flushed before being renamed into place, tokens are renewed a minute before they expire, and each tab shows its last content at once while it reloads (memory only).
- Smaller fixes: photos scaled off the main thread (iOS), shared ISO formatters, fewer inbox requests, the post-launch calls in parallel, biometry read once, the leave quote no longer flashes an error, Leave no longer loads twice before `/me`, the payslip share folder is cleared at session end.

## Capabilities

### Modified Capabilities
- `mobile-apps`: the offline clock-in queue (tap time, unreadable queue), and the network allow-list (no redirects).

## Non-goals

- A grace window for retrying a refresh token whose reply was lost (server rule from security review finding 23): an owner decision, not changed here.
- Treating a 4xx or 3xx punch answer without Crow HR's error body as temporary: `punch-queue-cases.json` specifies a refusal, so it stays as it is until the owner decides.
- No server, API, fixture or stored-data format change. Data stored by earlier versions reads as before.

## Impact

`apps/ios` (Core, App, Features, tests), `apps/android` (security, punch, auth, api, ui, tests), docs and changelog. No server change and no deploy; the apps ship in their next approved releases.
