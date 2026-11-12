---
title: HR letters and KETs
description: Generate offer letters, Key Employment Terms, confirmation, salary-change and employment letters from templates, and collect employee acknowledgements.
---

Letters are generated from templates under **Settings → Documents**, rendered to PDF and filed as a document on the employee (Contract & KETs for offer letters and KETs, Letters for everything else), with the template version used.

## Templates

Crow HR ships these templates, which you can reword:

- Key Employment Terms
- Offer letter
- Confirmation of employment
- Salary adjustment
- Certificate of employment

You can add your own (kinds: offer, KET, confirmation, promotion, salary adjustment, resignation acceptance, employment certificate, custom).

Templates are written in a restricted Markdown, with a live preview in the editor:

- `#`, `##` and `###` headings, paragraphs (line breaks are kept, for address blocks and sign-offs), `**bold**`, `*italic*`, bullet and numbered lists, pipe tables, and `\pagebreak` on its own line for a new page;
- `https` links only;
- merge fields written `{{namespace.field}}`, for example `{{employee.full_name}}`.

Raw HTML, images (the company logo is added for you) and non-https links are refused when you save, with the line number. Merge fields are filled in after the template is parsed, so a value can never turn into formatting or markup.

## Merge fields

Saving a template with an unknown field fails and names it, with a suggestion: "Unknown field employee.salary on line 12. Did you mean compensation.basic_pay?". The editor's field list shows them all:

| Group | Fields |
| --- | --- |
| Company | legal name, UEN, address |
| Employee | full name, preferred name, employee number, NRIC/FIN (masked), home address |
| Employment | job title, department, location, place of work, manager, start date, employment type, probation end date and period, working days, daily working hours, rest day, last working day, notice period |
| Pay (salary) | basic pay, pay basis, fixed allowances |
| Contract terms | main duties, duration, salary period, fixed deductions, overtime payment period and rate, other salary components, types of leave, medical benefits, effective date of a change, purpose of a letter |
| General | today's date, signatory name and job title |

Values are formatted the Singapore way: `S$4,200.00 a month`, `31 Oct 2026`. The full NRIC/FIN is deliberately not a field; only the masked form (`S****567D`) is.

**Contract terms** are things Crow HR doesn't store, such as main duties or medical benefits. Either write them into the template itself, or enter them when you generate the letter. Values entered for one document are saved on that document.

## Generating a letter

Pick the template, the employee and an "as at" date (for example the start date for a KET); every field is resolved from the employee's records as at that date. If any field has no value, generation stops and lists what is missing and where to fill it, for example "Manager (set it on the employment record)". You can fill in a missing value for this document only.

Templates that use **salary** fields can be generated only by an owner or a payroll admin (with salary access to that employee). An HR admin without payroll admin gets an error naming the salary fields.

Generated documents are frozen: the PDF, the template and version, the as-at date and a snapshot of the values used (without salary fields) are kept. Generating again creates a new document.

## Key Employment Terms

The KET template has a section for each of the items MOM requires in [Key Employment Terms](https://www.mom.gov.sg/employment-practices/contract-of-service/key-employment-terms), in MOM's order:

1. Full name of employer
2. Full name of employee
3. Job title, main duties and responsibilities
4. Start date of employment
5. Duration of employment (fixed-term contracts)
6. Working arrangements: daily working hours, working days per week, rest day
7. Salary period
8. Basic salary (or rate of pay)
9. Fixed allowances
10. Fixed deductions
11. Overtime payment period
12. Overtime rate of pay
13. Other salary-related components (bonuses, incentives)
14. Types of leave
15. Medical benefits
16. Probation period
17. Notice period
18. Place of work (optional)

MOM allows items 11 and 12 to be left out for employees not entitled to overtime; enter "Not applicable" for them in that case. Each section is marked with an anchor such as `<!-- ket:working_arrangements -->`. You can change the wording, but saving fails if a mandatory section or its merge fields are removed (place of work is optional).

KETs must be issued in writing within 14 days of the start of employment. Generating a KET completes the employee's "Issue KETs" onboarding checklist item.

## Acknowledgements

HR can ask an employee to read and acknowledge any document in a category they can see (generating a letter offers this too). The employee gets a notification and an item on Home.

- They must open the document before **I acknowledge** works; acknowledging without opening it is refused (`409 not_viewed`).
- The acknowledgement records the time, the IP address, the browser's user agent and the SHA-256 of the exact file version they opened. It cannot be withdrawn.
- Reminders go to the employee 3 days and 7 days after the request if it is still open.
- Replacing the document with a new version needs a new acknowledgement; the old one stays on record against the old version.

HR sees outstanding and completed acknowledgements per document and per employee, and can download them as CSV.

## Employment letter requests

Employees can ask for an employment letter (certificate of employment) from **Documents**, saying what it is for. The request goes through [approvals](/docs/approvals/approvals/) to HR. When HR approves, the letter is generated from the active certificate-of-employment template and filed in the employee's Letters, in the same step as the approval. If the letter can't be generated (for example a field is missing), the approval is refused with the reason.

## Limitations

- Acknowledgement is not an electronic signature. There is no Singpass Sign or DocuSign integration.
- *Italic* text prints in the regular typeface in PDFs (the embedded fonts have no italic face).
- The company logo is printed only when it is a PNG.
- Letters are PDF only; there is no DOCX output.
