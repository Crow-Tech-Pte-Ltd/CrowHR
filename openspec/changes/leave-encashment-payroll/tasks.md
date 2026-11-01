## 1. Regression tests
- [x] 1.1 Prove policy/scope protection, approval and balance reservation/release, next-run AW and CPF, final pay, adjustment carry and duplicate prevention.
## 2. Implementation
- [x] 2.1 Add encashment records, policy permission, workflow adapter and API; generate migration.
- [x] 2.2 Wire payroll feeds/reservations, immutable adjustment carry, rate working and change list.
- [x] 2.3 Add HR employee leave tab and self-service encashment UI with status and withdrawal.
## 3. Documentation and verification
- [x] 3.1 Update leave/payroll guides and regulatory citations; remove obsolete limitations and explain the gross-rate basis.
- [x] 3.2 Run full check, review and commit logical changes.
## 4. Gross-rate correction
- [x] 4.1 Add failing regressions for fixed and excluded variable allowances, effective dates, cessation, exact rounding, hourly balances and immutable payslip working.
- [x] 4.2 Price from effective basic pay plus classified fixed recurring allowances; require classification and preserve explicit gross-rate working.
- [x] 4.3 Update request copy, guides, limitations, regulatory evidence and these requirements; remove manual allowance top-ups.
- [x] 4.4 Run full check, review and commit the correction (227 test files, 2,164 tests passed; 2 skipped; sg-rules line coverage 99.72%; OpenAPI current; 82-page docs build and link checks passed).
