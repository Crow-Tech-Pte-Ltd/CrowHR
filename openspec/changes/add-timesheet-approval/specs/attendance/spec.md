## ADDED Requirements

### Requirement: Timesheet approval setting
Owners and hr_admins SHALL turn timesheet approval on or off per organisation in the attendance settings, choose the period (`monthly`: calendar month; `semi_monthly`: 1st–15th and 16th–last day; `weekly`: Monday–Sunday), who submits (`employee` or `manager`), and whether payroll uses approved timesheets only. Approval SHALL be off by default, with period `monthly`, submitter `employee` and payroll not limited; while it is off, punches, corrections, overtime claims and the payroll feeds SHALL behave exactly as without this capability. Payroll SHALL be limited to approved timesheets only while approval is on. A settings update that omits the timesheet settings SHALL keep the stored ones. Every change is audit-logged.

#### Scenario: Existing organisation
- **WHEN** an organisation that never opened the setting corrects a punch from last month
- **THEN** the correction is saved as before and nothing asks for a timesheet

#### Scenario: Payroll limit without approval
- **WHEN** an hr_admin saves payroll limited to approved timesheets with approval off
- **THEN** the save fails with 400, saying to turn timesheet approval on first

### Requirement: Timesheet submission
With approval on, a period SHALL be submittable from 04:00 Singapore time on the day after its last day. In `employee` mode the employee submits their own timesheet, and owners and hr_admins may submit on an employee's behalf; in `manager` mode the employee's manager (team) or an owner or hr_admin submits, and nobody submits their own. A submission SHALL record the period, who submitted it and the period's totals (days worked, worked minutes, overtime minutes, late count and minutes, early-out count, missing punches, leave days), and SHALL create an approval request of subject `timesheet` with the employee as requester. The default chain SHALL be the employee's manager with escalation after 3 days; organisations change it in Settings → Approvals. The response SHALL warn, without blocking, about missing punches and about days with overtime not claimed. A period with an open or approved timesheet, or overlapping one, SHALL NOT be submitted again (409); a period not yet over, or in which the employee was not employed, SHALL fail with 400 saying when it can be submitted or why not.

#### Scenario: Employee submits October
- **WHEN** on 1 Nov 2026 at 09:00 an employee with one missing punch in October submits their monthly timesheet
- **THEN** a pending timesheet for 1–31 Oct 2026 is created with its totals, their manager receives an approval task, and the response warns about the missing punch

#### Scenario: Too early
- **WHEN** an employee submits November on 30 Nov 2026
- **THEN** the request fails with 400, saying it can be submitted from 1 Dec 2026

#### Scenario: Manager mode
- **WHEN** submission is set to managers and a manager submits a report's timesheet
- **THEN** the manager cannot decide it, the request goes to the hr_admins, and the report cannot submit their own

### Requirement: Timesheet decisions
The approver SHALL see the period, the employee, the totals as they are now, the overtime claims in the period and, when the figures changed since submission, that they changed. Approving SHALL record the totals at the moment of approval and mark the timesheet `approved`. Returning SHALL use the engine's rejection, which requires a comment; the timesheet becomes `returned` with the comment and may be submitted again. The requester or the submitter SHALL be able to withdraw a pending timesheet, which ends its request as `withdrawn`. A submitted timesheet does not lock: corrections made while it waits are part of what is approved.

#### Scenario: Manager returns a timesheet
- **WHEN** the manager returns a timesheet with "Missing clock-out on 14 Oct"
- **THEN** the employee is notified with the comment, the timesheet is `returned`, and after the correction the employee submits it again

#### Scenario: Corrected while pending
- **WHEN** a manager adds a missing clock-out to a pending timesheet and then approves it
- **THEN** the approved totals include the added hours and the submitted totals are kept unchanged

### Requirement: Approved timesheets lock the period
While approval is on, the employee's dates inside an approved timesheet SHALL be locked: a punch with a work date in it SHALL be refused with 422 `punch_rejected` (reason `timesheet_locked`) naming the period; a correction (add or void) SHALL be refused with 409 `timesheet_locked`, except that an owner or hr_admin who confirms reopening SHALL make the correction and reopen the timesheet in one transaction; a new overtime claim for a locked date SHALL be refused with 409 `timesheet_locked`. A retried punch already recorded SHALL still return the original punch. Day records SHALL say whether each day is locked.

#### Scenario: Manager tries to correct an approved week
- **WHEN** a manager adds a punch to a day in their report's approved timesheet
- **THEN** the API answers 409 `timesheet_locked`, saying only HR can change it and that doing so reopens it

#### Scenario: HR corrects after approval
- **WHEN** an hr_admin adds a punch to a locked day and confirms reopening
- **THEN** the punch is added, the timesheet becomes `reopened`, both are audit-logged with the reason, and the employee is notified to submit it again

#### Scenario: Offline punch after approval
- **WHEN** a punch tapped on 31 Oct 2026 arrives after October's timesheet was approved
- **THEN** it is refused with 422 `punch_rejected`, saying the October timesheet is approved and to ask HR

### Requirement: Reopening a timesheet
Owners and hr_admins SHALL be able to reopen an approved timesheet with a reason of 3 to 300 characters, never their own. Reopening SHALL set the timesheet to `reopened`, keep its approval request as decided, unlock the period, audit-log the reason and notify the employee and the submitter. A reopened period SHALL be submitted and approved again before it locks.

#### Scenario: Employee cannot reopen
- **WHEN** an employee calls reopen on their own approved timesheet
- **THEN** the API answers 403 `forbidden`

### Requirement: Payroll from approved timesheets
When payroll is limited to approved timesheets, the payroll overtime feed SHALL list only approved overtime claims dated inside an approved timesheet of the employee, and the days-worked feed SHALL list only employees whose employed dates in the pay period all lie inside approved timesheets. Approved overtime left out SHALL be listed by the next run computed after its timesheet is approved. When not limited, both feeds SHALL be unchanged.

#### Scenario: Overtime waits for the timesheet
- **WHEN** payroll is limited, a 90-minute overtime claim for 12 Oct 2026 is approved and October's timesheet is still pending
- **THEN** the October feed does not list it, and once the timesheet is approved the feed lists the 90 minutes

#### Scenario: Days worked for a rostered employee
- **WHEN** payroll is limited and a rostered employee's November timesheet is approved
- **THEN** the November days-worked feed lists them, and a colleague whose timesheet is not approved is left out

### Requirement: Timesheets on Home
While approval is on, Home SHALL list "Submit your timesheet for <period>" for the latest ended period to an employee who was employed in it and has no open or approved timesheet for it (employee mode), and "Submit N timesheets for <period>" to a manager with that many such team members (manager mode). Approval tasks for timesheets appear like every other task.

#### Scenario: Reminder disappears after submitting
- **WHEN** an employee submits last month's timesheet from Home
- **THEN** the item is gone and their manager's Home shows the approval task
