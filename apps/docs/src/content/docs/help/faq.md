---
title: FAQ
description: Common questions about Crow HR - cost, hosting, data, compliance claims, modules and support.
---

## Is it really free?

Yes. The code is MIT-licensed. You can run it for your company, change it and redistribute it without paying Crow Tech. Your costs are the server you run it on and your time.

## Is there a hosted version?

No. Crow Tech does not run Crow HR for customers. You host it yourself: on a small cloud server, a machine in your office or anything that runs Docker.

## Does Crow Tech see our data?

No. The app sends nothing to Crow Tech: no analytics, telemetry or crash reports. It only contacts services you configure (your SMTP server, your identity provider and, optionally, your own error-monitoring service).

## Is Crow HR approved by CPF Board, IRAS or MOM?

No. Crow HR is not approved, certified or endorsed by any government agency. Its statutory rules come from cited official sources and are tested against official examples and CPF's online calculator ([how we verify](/docs/payroll/verification/)), but you remain responsible for your payroll and submissions. It is not an IRAS-approved AIS vendor.

## Can it submit CPF, IR8A or salary payments for us?

No. It produces the CPF EZPay file, a generic bank file and IR8A rows, and you upload them in CPF EZPay, your bank and myTax Portal. See [integrations](/docs/integrations/).

## Can we use it for leave, claims or attendance?

Yes. [Leave](/docs/leave/leave/), [attendance and overtime](/docs/attendance/attendance/), [claims](/docs/claims/claims/) and [shift scheduling](/docs/scheduling/scheduling/) are built, and approved no-pay leave, overtime and claims flow into payroll. They are new: see each page's limitations, and check the first runs that use them.

## We are moving from another system mid-year. What do we need?

Import employees and their compensation, then the [year-to-date opening balances](/docs/people/importing/#year-to-date-opening-balances) so the CPF AW ceiling is right for the rest of the year. Run one month in parallel with your old system and compare.

## Can several companies share one install?

Yes. Each legal entity is its own organisation with its own UEN and CSN, and one person can belong to several. The web app's organisation switcher does not switch yet: it shows only the organisation you are signed in to. To work in another one, sign out and sign in on that organisation's sign-in page (`/sign-in/<org>`).

## Does it work on phones?

The web app works on phone screens, with a bottom tab bar for employees. The native [Android app](/docs/coming-soon/mobile-apps/) is on Google Play, and the iPhone and iPad app is in App Store review. **My profile → Mobile app** shows the code that connects the app to your server.

## Is there a demo?

Yes: the [in-browser demo](/docs/demo/) at [hr.crow.sg](https://hr.crow.sg/) runs the real app with a fictional company, entirely in your browser. To try it with your own data, install Crow HR with the [quick start](/docs/quick-start/).

## Do we need Singpass?

No. Singpass login is optional and requires your company's own Singpass onboarding. It has been tested against Singpass staging, not yet against production. Email and password, Google Workspace, Microsoft Entra ID and other OpenID Connect providers work without it.

## How do we get support?

Through the project's [public issue tracker](https://github.com/Crow-Tech-Pte-Ltd/CrowHR/issues), on a best-effort basis. There is no paid support contract today. Security issues go through the [security policy](/docs/help/security/), not public issues.
