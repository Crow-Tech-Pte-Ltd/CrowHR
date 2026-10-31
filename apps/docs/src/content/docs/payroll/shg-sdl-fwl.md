---
title: SHG funds, SDL and FWL
description: How Crow HR computes self-help group fund contributions, the Skills Development Levy and its foreign worker levy estimate.
---

## Self-help group (SHG) funds

SHG contributions are deducted from the employee's pay and paid to CPF Board with the CPF contribution, for one of four funds:

| Fund | For |
| --- | --- |
| CDAC | Chinese |
| ECF | Eurasian |
| MBMF | Muslim (by religion) |
| SINDA | Indian descent, including the groups SINDA lists (for example Tamil, Punjabi, Sikh, Sinhalese, Bengali) |

Crow HR picks the fund from the race and religion recorded on the employee's profile, following CPF's [rules for determining the fund](https://www.cpf.gov.sg/service/article/how-do-i-determine-which-self-help-group-shg-my-employee-should-contribute-to), and looks up the amount in the fund's table by the month's total wages. Record an opt-out, with its date, on the employee's profile when the employee has opted out with the fund.

Check race and religion on import: a missing value means no fund is chosen. The CDAC, ECF and SINDA tables are verified as current, but CPF does not publish their start dates, so Crow HR does not claim history before 2025.

## Skills Development Levy (SDL)

SDL is paid by the employer for each employee, never deducted from pay:

- 0.25% of the month's total wages, at least **S$2** (for wages below S$800) and at most **S$11.25** (for wages above S$4,500);
- **S$0** for a month with no wages paid or payable;
- exemptions encoded from the SSG FAQ (domestic workers, no service in Singapore, approved training, school-holiday students and others) are applied only when recorded.

SDL is included in the CPF EZPay file under payment code 11.

## Foreign worker levy estimate

For S Pass and Work Permit holders, Crow HR shows an **estimate** of the monthly foreign worker levy from the sector, tier and skill in [payroll settings](/docs/payroll/settings/), using MOM's published monthly rates (services, manufacturing, construction, process, marine shipyard).

:::caution[Estimate only]
MOM bills the levy and its bill is authoritative. Your tier depends on MOM's own quota computation, which Crow HR does not reproduce. The levy is borne by the employer and must never be deducted from salary; Crow HR shows it as an employer cost only.
:::

## Not computed

- Income tax (Crow HR does not withhold tax), IR21 tax clearance for foreign or SPR leavers.
- CPF late-payment interest.
- Work-pass qualifying salaries.

See [limitations](/docs/payroll/limitations/).
