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


## Appearance

The company owner can set the web app logo and accent colour in **Settings → Company → Appearance**, or during first-run setup. Paste a hex colour, upload a PNG (up to 256 KB and 2048 × 2048 pixels), or reuse the logo you uploaded for generated letters. The light and dark previews show how the primary action and logo will look. Select **Save appearance** to apply the change or **Reset appearance** to restore the Crow HR look.

The app logo and accent appear on the company's sign-in page and in the signed-in web app. Anyone with the company sign-in address can see them. An uploaded app logo is separate from the logo on generated letters.

## AI assistants

On an HTTPS install, set `AI_ASSISTANT_ENABLED=1` in `.env` and start the app with `docker compose up -d`. On a new install, opt in on the Company step of setup. On an existing install, go to **Settings → Company → AI assistants** and select **Enable AI assistants**.

1. Copy the company-specific connector URL. Your HTTPS reverse proxy must allow clients to reach `/mcp/*` and the OAuth endpoints under `/.well-known/` on the same domain.
2. In a [supported ChatGPT workspace](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt), add a custom MCP connector with that URL and OAuth. In [Claude](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp), choose a custom web connector, OAuth and **Register automatically**.
3. Each person signs in with their normal Crow HR sign-in and approves sharing. Try asking for their available annual leave, next published shift or pending approval count.

Assistant providers receive the results and can retain them with conversations under their workspace settings. The tools are read-only. To disconnect your account, open **Sign-in and devices → AI assistants** in Crow HR. Owners can disconnect every account by disabling the connector for the company. Connections expire after 30 days. The public demos have the connector disabled.

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
