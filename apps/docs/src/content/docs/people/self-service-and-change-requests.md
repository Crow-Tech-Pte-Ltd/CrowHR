---
title: Self-service and change requests
description: What employees can change themselves in Crow HR, and how changes to legal and bank details are approved.
---

Employees see their own record in **My profile** and their payslips in **Payslips**.

## Changed directly

These are saved straight away and audit-logged:

- preferred name
- personal email and mobile number
- address
- emergency contacts (up to 3)

## Changed through a request

Changes to these fields create a **change request** with an optional attachment:

- legal name, ID number, date of birth
- residency status and PR start date
- race and religion
- bank details

While the request is pending, the employee sees the new values marked **Awaiting approval**; everywhere else, including payroll, the current values stay in force.

Requests go through the [approvals engine](/docs/approvals/approvals/): by default **bank details go to payroll admins** and everything else to **HR admins**. The approver sees the change and the attachment and approves or rejects with a comment. Bank changes apply from the approval date; other personal details apply from the approval date (future-dated personal details are not supported).

Approvers act from Home or the Inbox. Nobody approves their own request, except an owner when no one else can.

## Segregation of duties

Nobody, including owners and payroll admins, edits their own compensation or bank details directly. A payroll admin who needs a raise or a new bank account gets it through someone else, which leaves an audit trail.

Bank-change summaries, including holder names and account endings, are restricted to the requester, payroll admins and owners. HR admins need the payroll admin role to read them. All decisions use the approval chain; the former direct people decision endpoint has been removed.
