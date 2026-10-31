---
title: Approvals
description: How Crow HR routes requests for approval - policies, steps, fallbacks, delegation, escalation - and where approvers act on them.
---

Every request that needs a decision goes through one approval engine. Today two kinds of request use it: **profile changes** (employees' changes to legal, residency, race/religion and bank details) and **payroll runs**. Leave, leave cancellation, claims, overtime, timesheets and shift swaps are listed in **Settings → Approvals** as "Not in use yet": their modules are [not built](/docs/status/).

## Where approvers decide

- **Home** lists everything waiting for you, overdue first, then by due date. Profile changes can be approved or rejected inline.
- **Inbox** shows open tasks with the request's summary, the requester's context, the approval chain with its progress and earlier comments.

![Home: work to do, with approvals waiting, checklist items, an expiring work pass and a probation review (fictional company)](../../../assets/screens/home-work-to-do.webp)

Rejecting needs a comment (1 to 500 characters); approving does not. When several people can decide a step, the first decision closes it and the others' tasks are marked superseded. Deciding a task that someone already decided gives `409 already_decided`.

## Policies

Owners and HR admins edit the chain for each request type in **Settings → Approvals**. Only owners edit the payroll run policy.

![Settings → Approvals with the default chains and the out-of-office cover section (fictional company)](../../../assets/screens/settings-approvals.webp)

A policy has:

- an optional **condition**: an amount at or above a threshold, or a type code in a list;
- a **priority** (the highest-priority matching policy wins, otherwise the default);
- **1 to 5 steps**, each approved by the requester's **manager**, their **manager's manager**, anyone holding a **role** (HR admin, payroll admin, owner) or a **specific member**;
- an **escalation** after N calendar days (default 3; 0 turns it off).

Defaults, used until you edit them:

| Request | Default chain |
| --- | --- |
| Payroll run | Owner |
| Profile change | Bank details: payroll admin. Other fields: HR admin. |
| Every other type | Manager, then HR admin |

The chain is copied onto each request when it is submitted, so editing a policy does not change requests already in flight.

## When a step has nobody

A step is skipped (and the reason recorded) when it resolves to the requester themselves, to nobody (for example, no manager) or to a suspended or former member. If every step is skipped, the request goes to HR admins; for payroll runs, and when the requester is the only HR admin, to owners. If no eligible member other than the requester exists, an owner who is the requester may decide, and the decision is marked **self-approved**. A request is never approved without a recorded decision by a member.

## Delegation (out-of-office cover)

Anyone can set cover from the Inbox: a delegate, a start and end date (inclusive) and optionally which request types. While cover is active, the delegate also gets the delegator's tasks; the delegator keeps them too. A delegate never gets tasks for their own requests, role-based steps only go to delegates who hold that role, and the delegate can read a request only while its task is open. HR admins can set cover for anyone in Settings → Approvals.

## Escalation and reassignment

When a task passes its due time, its assignees get a reminder and a task is added for the next level: the assignee's manager, or the HR admins if there is none or the assignee is an HR admin. This happens once per step.

Owners and HR admins can reassign any pending task to another eligible member, with a reason (HR admins cannot reassign payroll run tasks). When a requester's manager changes, open manager tasks move to the new manager.

## Withdrawing

A requester can withdraw a pending request; open tasks are superseded and the approvers are told. A payroll run in review can be withdrawn back to draft.

## Background processing

Escalations, reminders, the email outbox and date-triggered changes (such as a leaver's membership becoming former) are processed by a sweep the server runs every 60 seconds. Each piece of work is claimed with a row lock, so nothing is processed twice, and after downtime the next sweep catches up.
