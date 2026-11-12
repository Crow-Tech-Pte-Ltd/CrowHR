## MODIFIED Requirements
### Requirement: Offline clock-in queue
A clock-in or clock-out tapped while offline, or while the server is unreachable, SHALL be queued on the device with: a client-generated idempotency key, device wall-clock time, monotonic time since boot, time-zone offset, and the location and accuracy radius when the organisation's attendance policy asks for location and the user granted permission. The device time and the monotonic reading SHALL be those of the tap, taken before any wait for a location fix or a permission prompt. A tap SHALL be saved and sent even when the user leaves the clock screen straight after it. Queued punches SHALL be sent in order when connectivity returns. The server's decision (accepted, flagged with reason, or rejected with reason) SHALL be shown per punch. The queue SHALL hold up to 200 punches. A punch older than 7 days SHALL still be sent; the server refuses it (attendance spec), and the app SHALL keep it visible with the server's reason ("ask your manager to add it to your timesheet") until the user dismisses it. Native apps SHALL send the monotonic elapsed time since the tap (`elapsedMs`) when the device has not restarted, so the server records the real tap time even if the clock was changed. A stored queue that exists but can't be read yet (an iPhone still locked after iOS started the app in the background) SHALL NOT be treated as empty: the app SHALL NOT write over it or send any punch before it, and SHALL read it as soon as it can. The app SHALL never alter or drop a queued punch silently.

#### Scenario: Punch in a basement
- **WHEN** an employee clocks in with no signal at 08:58 and connectivity returns at 09:20
- **THEN** the punch is submitted at 09:20 with a recorded time of 08:58, and the app shows "Synced" or the server's flag reason

#### Scenario: Duplicate send
- **WHEN** the network drops after the server stored a punch but before the app received the response, and the app retries
- **THEN** the server returns the original result for the same idempotency key, and only one punch exists

#### Scenario: Waiting for the location fix
- **WHEN** the policy asks for location, an employee taps Clock in at 08:59:55 and the fix arrives at 09:00:05
- **THEN** the punch's device time is 08:59:55, its `elapsedMs` counts from 08:59:55, and the server records 08:59:55

#### Scenario: Background launch while locked
- **WHEN** two punches are waiting on an iPhone and iOS starts the app in the background while the phone is locked
- **THEN** after the phone is unlocked both punches are still on the phone and are sent oldest first, and a later tap is queued after them

### Requirement: Zero data collection
The apps SHALL make network requests only to the configured Crow HR server, plus the identity provider pages opened in the system browser. They SHALL NOT follow an HTTP redirect from an API request; the redirect is handled as the server's answer. They SHALL include no analytics, crash reporting, advertising or other third-party SDKs that transmit data. The App Store privacy label SHALL be "Data Not Collected" and the Play Data safety form SHALL declare no data collected or shared by the developer, after an audit of all transitive dependencies. Cached data (payslip list, leave balances, schedule, queued punches) SHALL be stored encrypted on the device and deleted on sign-out. The app switcher snapshot SHALL be obscured. On Android, screens showing payslips SHALL set `FLAG_SECURE`.

#### Scenario: Network allow-list test
- **WHEN** the UI test suite runs a full ESS journey against a test server while recording all outbound connections
- **THEN** every connection goes to the test server's host

#### Scenario: Redirect to another host
- **WHEN** the server, a proxy or a captive portal answers an API request with a redirect to another host
- **THEN** no request reaches that host and the session is kept
