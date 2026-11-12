---
title: Company and structure
description: Set the company profile (UEN, CSN, address), departments, teams, locations, cost centres and work schedules in Crow HR.
---

Owners and HR admins maintain these in **Settings → Company** and **Settings → Structure**. Everyone else can read them.

## Company profile

One Crow HR organisation is one legal entity, with one UEN and one CSN. A group of companies is set up as separate organisations; one person can belong to several and switch between them.

| Field | Rules |
| --- | --- |
| Legal name | Required. Printed on payslips as the employer's full name, so payslips cannot be released without it. |
| Trading name | Optional. |
| UEN | Required. Must match one of ACRA's three formats: 8 digits and a letter (businesses), a 4-digit year, 5 digits and a letter (local companies), or `T`/`S`, 2 digits, a 2-character entity type, 4 digits and a letter (other entities). |
| CPF submission number (CSN) | Your UEN, a 3-letter payment type and a 2-digit serial, for example `201912345KPTE01`. Payment types are `PTE` (staff), `AMS`, `VCT` and `MSE`. It must start with the UEN above. |
| Registered address | Block or house number, street, unit, building and a 6-digit postal code. |
| Logo | **Upload logo** under the address. PNG only (type detected from content), at most 1 MB; export SVG artwork as PNG first. Printed on letters generated from templates. |

Payroll cannot be submitted until the profile has a UEN, a CSN and an address. Time zone (Asia/Singapore) and currency (SGD) are fixed.

## Structure

**Settings → Structure** holds four flat lists:

- **Departments**
- **Teams**, each optionally inside one department
- **Locations**, with an address and postal code
- **Cost centres**, with a unique code and a name

Names are unique among active entries of the same list. Entries are archived, never deleted, so history stays readable. An entry that a current employee uses cannot be archived: the error (`409 in_use`) says how many employees use it and links to that filtered list.

## Work schedules

Payroll pro-rates salary from the employee's working days, and leave and attendance count days and measure lateness and overtime from it, so create the default schedule early.

- A **fixed** schedule sets each weekday to *working* (with contracted hours), *half* (working, fewer hours), *off* or *rest*. It must have exactly one rest day. Weekly contracted hours are the sum of the days.
- A **shift** schedule takes its days from published [rosters](/docs/scheduling/scheduling/). For an incomplete month, payroll needs these employees' scheduled days and days worked: they come from published rosters and attendance when available, otherwise HR enters them on the run. Crow HR does not guess a week.

One schedule is the default for new employees. Editing a schedule creates a new effective-dated version, so earlier months keep the schedule that applied then.
