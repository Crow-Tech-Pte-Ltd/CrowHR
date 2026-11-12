---
title: Integrations
description: What Crow HR connects to today (SSO, SMTP, file storage, files for CPF, banks and IRAS) and what is not available (IRAS AIS API, bank-specific formats, Myinfo).
---

Crow HR is designed to run without any external service. Everything below is optional and configured by you.

## Available

| Integration | How | Guide |
| --- | --- | --- |
| Google Workspace sign-in | OpenID Connect | [Google Workspace](/docs/admin/sso/google-workspace/) |
| Microsoft Entra ID sign-in | OpenID Connect, single tenant | [Microsoft Entra ID](/docs/admin/sso/microsoft-entra-id/) |
| Okta, Keycloak, Authentik and other OIDC providers | OpenID Connect with discovery | [Generic OIDC](/docs/admin/sso/generic-oidc/) |
| Singpass login | FAPI 2.0 profile; needs your own relying-party onboarding; tested against Singpass staging, not production yet | [Singpass](/docs/admin/sso/singpass/) |
| Email | Any SMTP server (`SMTP_URL`, `MAIL_FROM`) | [Configuration](/docs/self-hosting/configuration/#email) |
| CPF Board | CPF EZPay (FTP) file, uploaded by you | [CPF EZPay file](/docs/payroll/cpf-ezpay-file/) |
| Banks | Generic ISO 20022 `pain.001.001.03` file, uploaded by you | [Bank file](/docs/payroll/bank-file/) |
| IRAS | IR8A rows for IRAS's import template, imported by you in myTax Portal | [IR8A export](/docs/payroll/ir8a-export/) |
| Spreadsheets | CSV import of employees, compensation and YTD balances; CSV/XLSX export of employees; CSV export of the audit log | [Importing](/docs/people/importing/) |
| Your own tools | The REST API used by the web app, documented in OpenAPI | [API reference](/docs/api/) |

## Files

Uploaded files are stored on the server's disk in the data volume (`FILE_STORAGE_DIR`, default `/data/files`) and included in every backup. Object storage such as S3 is not supported.

## API access for integrations

The API authenticates browser sessions (cookie) and native-app tokens (bearer, from the native sign-in flow). There are **no API keys or service accounts** for server-to-server integrations. See [API conventions](/docs/developers/api-conventions/).

## Not available

- **IRAS AIS API** (direct IR8A submission): requires IRAS to approve the software as a vendor, Corppass authorisation, APEX credentials and whitelisted servers.
- **Direct CPF submission**: you upload the EZPay file in CPF's portal.
- **Bank-specific formats and bank APIs** (DBS, OCBC, UOB and others): only the generic ISO 20022 file exists, untested with any bank.
- **Myinfo**: Singpass login requests only `openid`; no personal data is retrieved from Myinfo.
- **MOM systems** (work pass applications, levy billing).
- **Accounting exports** (journal entries, GL codes), **calendar feeds**, **webhooks**, **Slack or Teams** notifications.
- **Push notifications** to phones: the [mobile apps](/docs/mobile-apps/) check for new notifications in the background and show them as local notifications instead.
