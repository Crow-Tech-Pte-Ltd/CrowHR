#!/usr/bin/env python3
"""Independent audit, Python stdlib only; run from any directory.

No imported rule tables or expected results participate in calculations.
Integer cents and integer basis points retain sub-cent precision until rounding.
Sources independently read on 2026-10-31:
CPF 2026 PDF: https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/CPFcontributionratesfrom1Jan2026.pdf
CPF 2027 PDF: https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/jan2027cpfcontributionrates.pdf
CPF 2025 PDF: https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/jan2025_contributionandallocationrates.pdf
SHG: https://www.cpf.gov.sg/employer/employer-obligations/contributions-to-self-help-groups
SDL: https://www.cpf.gov.sg/employer/employer-obligations/skills-development-levy
"""

import calendar
import hashlib
import json
from collections import Counter
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

HERE = Path(__file__).resolve().parent
RESEARCH = HERE.parent
AGES = ['AGE_55_AND_BELOW', 'ABOVE_55_TO_60', 'ABOVE_60_TO_65',
        'ABOVE_65_TO_70', 'ABOVE_70']
# Separately transcribed employer/employee bps, age order as above.
FULL = {
    2025: [(1700, 2000), (1550, 1700), (1200, 1150), (900, 750), (750, 500)],
    2026: [(1700, 2000), (1600, 1800), (1250, 1250), (900, 750), (750, 500)],
    2027: [(1700, 2000), (1650, 1900), (1300, 1300), (900, 750), (750, 500)],
}
GG = {
    1: [(400, 500), (400, 500), (350, 500), (350, 500), (350, 500)],
    2: [(900, 1500), (600, 1250), (350, 750), (350, 500), (350, 500)],
}
SHG = {
    'CDAC': [(200000, 50), (350000, 100), (500000, 150), (750000, 200), (None, 300)],
    'ECF': [(100000, 200), (150000, 400), (250000, 600), (400000, 900),
            (700000, 1200), (1000000, 1600), (None, 2000)],
    'MBMF': [(100000, 300), (200000, 450), (300000, 650), (400000, 1500),
             (600000, 1950), (800000, 2200), (1000000, 2400), (None, 2600)],
    'SINDA': [(100000, 100), (150000, 300), (250000, 500), (450000, 700),
              (750000, 900), (1000000, 1200), (1500000, 1800), (None, 3000)],
}


def sdl_units(cents):
    # 1 unit = 1/10000 cent = 1/1000000 dollar. No employee rounding.
    # SSG FAQ D4: no wages paid OR payable during no-pay leave => no levy.
    if cents == 0:
        return 0
    return min(11250000, max(2000000, cents * 25))


def dollars(units):
    return format(Decimal(units) / Decimal(1000000), 'f')


def shg(fund, wages):
    if not fund:
        return 0  # Missing fund means none elected in this fixture, not an eligibility decision.
    return next(amount for ceiling, amount in SHG[fund] if ceiling is None or wages <= ceiling)


def rates(year, table, age):
    full_er, full_ee = FULL[year][age]
    if table == 1:
        return full_er, full_ee
    spr_year = 1 if table in (2, 4) else 2
    er, ee = GG[spr_year][age]
    return (full_er if table in (4, 5) else er), ee


def ym(value):
    return tuple(map(int, value[:7].split('-')))


def cpf(inp):
    year, month = ym(inp['wageMonth'])
    source_year = min(year, 2027)
    age = AGES.index(inp['ageBand'])
    if 'birthDate' in inp:
        by, bm = ym(inp['birthDate'])
        age = sum((year, month) > (by + milestone, bm) for milestone in (55, 60, 65, 70))
        assert AGES[age] == inp['ageBand'], 'incorrect fixture age band'
    table, category = 1, inp['residency']
    if category == 'SPR':
        sy, sm = ym(inp['spr']['sprDate'])
        spr_year = 1 if (year, month) <= (sy + 1, sm) else 2 if (year, month) <= (sy + 2, sm) else 3
        option = inp['spr']['option']
        category = 'SPR3' if spr_year == 3 else f'SPR{spr_year}_{option}'
        table = 1 if spr_year == 3 or option == 'FF' else spr_year + (1 if option == 'GG' else 3)
    ow_paid, aw_paid = inp['owPaidCents'], inp['awPaidCents']
    wage_total = ow_paid + aw_paid
    ow = inp.get('owSubjectToCpfCents', min(ow_paid, 740000 if year == 2025 else 800000))
    aw, ceiling = aw_paid, None
    if 'awCeilingContext' in inp:
        ctx = inp['awCeilingContext']
        ceiling = max(0, 10200000 - ctx['annualOwSubjectForCeilingCents'])
        aw = min(aw_paid, max(0, ceiling - ctx['awSubjectYtdBeforeCents']))
    total, employee = 0, 0
    if category == 'FOREIGNER':
        table, ow, aw = None, 0, 0
    else:
        er, ee = rates(source_year, table, age)
        subject = ow + aw
        # CPF wage band is before AW ceiling, per official AW example 16.
        band_wages = wage_total
        if 'spr' in inp and ym(inp['spr']['sprDate']) == (year, month):
            band_wages = subject  # Exclude pre-conversion wages from CPF eligibility.
        if band_wages <= 5000:
            total_numerator = employee_numerator = 0
        elif band_wages <= 50000:
            total_numerator, employee_numerator = subject * er, 0
        elif band_wages <= 75000:
            if subject != band_wages:
                raise ValueError('Unverified low-wage/AW-ceiling combination; do not invent a negative contribution')
            # Printed coefficients = 3 x employee full-band rate in each table.
            employee_numerator = (subject - 50000) * (ee * 3)
            total_numerator = subject * er + employee_numerator
        else:
            total_numerator, employee_numerator = subject * (er + ee), subject * ee
        # Numerators are units of 1/10000 cent. One dollar = 1,000,000 units.
        total = ((total_numerator + 500000) // 1000000) * 100
        employee = (employee_numerator // 1000000) * 100
    units = sdl_units(wage_total)
    out = dict(rateTable=None if table is None else f'{source_year}:T{table}',
               effectiveResidencyCategory=category, owSubjectToCpfCents=ow,
               awSubjectToCpfCents=aw, totalCpfCents=total,
               employeeCpfCents=employee, employerCpfCents=total - employee,
               sdlUnits1e4Cent=units, sdlExactDollars=dollars(units),
               shgCents=shg(inp.get('shgFund'), wage_total))
    if ceiling is not None:
        out['awCeilingCents'] = ceiling
    return out


def sdl(inp):
    if 'totalWagesCentsPerEmployee' in inp:
        units = sum(sdl_units(w) for w in inp['totalWagesCentsPerEmployee'])
        return dict(sdlExactDollars=dollars(units), sdlPayableCents=(units // 1000000) * 100)
    units = sdl_units(inp['totalWagesCents'])
    return dict(sdlUnits1e4Cent=units, sdlExactDollars=dollars(units))


def shg_vector(inp):
    wages = inp.get('totalWagesCents', inp.get('owPaidCents', 0) + inp.get('awPaidCents', 0))
    if 'funds' in inp:
        values = {fund: shg(fund, wages) for fund in inp['funds']}
        return dict(shgCentsByFund=values, shgCents=sum(values.values()))
    return dict(shgCents=shg(inp['fund'], wages))


def audit_tables(rules):
    checks = []

    def check(path, actual, independent, source):
        checks.append(dict(path=path, actual=actual, independent=independent,
                           matches=actual == independent, source=source))

    def tree(path, actual, expected, source):
        if isinstance(expected, dict):
            for key, val in expected.items():
                tree(path + '.' + key, actual[key], val, source)
        elif isinstance(expected, list):
            for i, val in enumerate(expected):
                tree(f'{path}[{i}]', actual[i], val, source)
        else:
            check(path, actual, expected, source)

    for ti, table in enumerate(rules['cpf']['rateTables']):
        year = int(table['effectiveFrom'][:4])
        tn = table['publishedTableNo']
        root = f'cpf.rateTables[{ti}]'
        check(root + '.publishedTableNo', tn,
              {'SC_AND_SPR3': 1, 'SPR1_GG': 2, 'SPR2_GG': 3, 'SPR1_FG': 4, 'SPR2_FG': 5}[table['id'][9:]], table['source'])
        for ai, age_band in enumerate(table['ageBands']):
            er, ee = rates(year, tn, ai)
            for wi, wb in enumerate(age_band['wageBands']):
                expected = [dict(twFromExclusiveCents=None, twToInclusiveCents=5000),
                            dict(twFromExclusiveCents=5000, twToInclusiveCents=50000, employerRateBps=er),
                            dict(twFromExclusiveCents=50000, twToInclusiveCents=75000,
                                 employerRateBps=er, phaseInCoefficientBps=ee * 3),
                            dict(twFromExclusiveCents=75000, twToInclusiveCents=None,
                                 totalRateBps=er + ee, employeeRateBps=ee,
                                 maxTotalOnOwCents=(740000 if year == 2025 else 800000) * (er + ee) // 10000,
                                 maxEmployeeOnOwCents=(740000 if year == 2025 else 800000) * ee // 10000)][wi]
                for key, value in expected.items():
                    check(f'{root}.ageBands[{ai}].wageBands[{wi}].{key}', wb.get(key), value, table['source'])
    for fi, fund in enumerate(rules['shg']['funds']):
        for bi, (bound, value) in enumerate(SHG[fund['fund']]):
            for key, expected in [('upToInclusiveCents', bound), ('amountCents', value)]:
                check(f'shg.funds[{fi}].bands[{bi}].{key}', fund['bands'][bi][key], expected, fund['source'])
    for i, row in enumerate(rules['foreignWorkerLevy']['foreignWorkerLevy']):
        check(f'foreignWorkerLevy.foreignWorkerLevy[{i}].dailyCents', row['dailyCents'],
              (row['monthlyCents'] * 12 + 364) // 365, row['sources'][0])
    # Monthly figures separately read from MOM sector pages and COS 2026 Annex C.
    monthly = [650, 300, 450, 400, 600, 600, 800, 250, 370, 350, 470, 550, 650,
               400, 600, 600, 800, 300, 470, 550, 650, 300, 700, 500, 900, 250,
               370, 900, 200, 450, 600, 300, 650, 800, 350, 500, 600]
    for i, amount in enumerate(monthly):
        row = rules['foreignWorkerLevy']['foreignWorkerLevy'][i]
        check(f'foreignWorkerLevy.foreignWorkerLevy[{i}].monthlyCents', row['monthlyCents'], amount * 100, row['sources'][0])
    quota = rules['foreignWorkerLevy']['dependencyRatioCeilings']
    tree('foreignWorkerLevy.dependencyRatioCeilings', quota, {
        'SERVICES': dict(drc='35%', sPassSubDrc='10%', prcSubDrc='8%'),
        'MANUFACTURING': dict(drc='60%', sPassSubDrc='15%', prcSubDrc='25%'),
        'CONSTRUCTION': dict(drc='83.3%', sPassSubDrc='15%', wpPerLocal=5),
        'PROCESS': dict(drc='83.3%', sPassSubDrc='15%', wpPerLocal=5),
        'MARINE_SHIPYARD': dict(drc='75%', sPassSubDrc='15%', wpPerLocal=3),
        'ntsOccupationListSubDrc': '8%'}, quota['sources'][0])
    # All 23 ages per column visually checked against MOM's two eligibility pages.
    # Interpolation is an audit compression, NOT a claim MOM prescribes this algorithm.
    endpoints = [(5600, 10700), (6000, 11500), (6200, 11800), (6600, 12700),
                 (3300, 4800), (3600, 5100), (3800, 5650), (4000, 5650)]
    for i, (start, end) in enumerate(endpoints):
        row = rules['workPasses']['workPassQualifyingSalaries'][i]
        for age in range(23, 46):
            amount = (Decimal(start) + Decimal(end - start) * (age - 23) / 22).quantize(Decimal(1), rounding=ROUND_HALF_UP)
            check(f'workPasses.workPassQualifyingSalaries[{i}].minMonthlySalaryCentsByAge.{age}',
                  row['minMonthlySalaryCentsByAge'][str(age)], int(amount) * 100, row['sources'][0])
    for i, value in enumerate([2250000, 3000000, 300000, 2250000, 600000, 200000]):
        row = rules['workPasses']['otherSalaryThresholds'][i]
        check(f'workPasses.otherSalaryThresholds[{i}].minFixedMonthlySalaryCents', row['minFixedMonthlySalaryCents'], value, row['sources'][0])
    row = rules['workPasses']['otherSalaryThresholds'][6]
    tree('workPasses.otherSalaryThresholds[6]', row, dict(minGrossMonthlyCents=180000, halfCountFromCents=90000), row['sources'][0])
    tree('cpf.owCeiling', rules['cpf']['owCeiling'], [dict(monthlyCents=740000), dict(monthlyCents=800000)],
         'https://www.cpf.gov.sg/service/article/what-is-the-ordinary-wage-ow-ceiling')
    tree('cpf.annualSalaryCeiling', rules['cpf']['annualSalaryCeiling'], [dict(annualCents=10200000)],
         'https://www.cpf.gov.sg/service/article/what-is-the-ordinary-wage-ow-ceiling')
    row = rules['sdl']['rates'][0]
    tree('sdl.rates[0]', row, dict(rateBps=25, minPerEmployeeCents=200,
         minAppliesBelowTotalWagesCents=80000, maxPerEmployeeCents=1125, maxAppliesAboveTotalWagesCents=450000), row['sources'][0])
    ea = rules['employmentAct']
    for key, expected in {
        'part4Coverage': [dict(workmanMaxBasicMonthlyCents=450000, nonWorkmanMaxBasicMonthlyCents=260000)],
        'overtime': [dict(multiplierBps=15000, normalHoursPerWeek=44, maxOvertimeHoursPerMonth=72,
             maxHoursPerDay=12, nonWorkmanOtBaseCapMonthlyCents=260000,
             nonWorkmanPublishedHourlyCapCents=1360, payWithinDaysAfterPeriod=14)],
        'salaryPayment': dict(maxSalaryPeriodMonths=1, payWithinDaysAfterPeriod=7, overtimePayWithinDaysAfterPeriod=14),
        'deductions': dict(maxTotalPctBps=5000, damageOrLossMaxPctOfMonthBps=2500,
             accommodationAmenitiesMaxPctBps=2500, advanceInstalmentMaxPctBps=2500,
             advanceMaxMonths=12, loanInstalmentMaxPctBps=2500),
        'partTime': dict(thresholdHoursPerWeekExclusive=35),
    }.items():
        obj = ea[key]
        tree('employmentAct.' + key, obj, expected, (obj[0] if isinstance(obj, list) else obj)['source'])
    lv = rules['leave']
    expected_leave = {
        'annualLeave': [dict(minServiceMonths=3, part4CarryForwardMonths=12,
             daysByServiceYear=[dict(serviceYear=n, days=n + 6) for n in range(1, 9)])],
        'sickLeave': [dict(minServiceMonths=3, notifyEmployerWithinHours=48,
             byCompletedMonths=[dict(months=m, outpatientDays=o, hospitalisationDaysInclOutpatient=h)
                                for m, o, h in [(3, 5, 15), (4, 8, 30), (5, 11, 45), (6, 14, 60)]])],
        'childcareLeave': [dict(childAgeBelow=7, daysPerYear=6, reimbursementCapPerDayCents=50000,
             lifetimeDaysPerChild=42, newHireProrationByCompletedMonths={str(m): max(2, (m + 1) // 2) for m in range(3, 13)}),
             dict(daysPerYear=2, reimbursementCapPerDayCents=50000, lifetimeDaysPerChild=12),
             dict(childAgeBelow=7, daysPerYear=2),
             dict(daysPerYearByNumberOfChildren={'1': 8, '2': 10, '3+': 12}, childMaxAge=12)],
        'unpaidInfantCareLeave': [dict(daysPerYear=12, childAgeBelow=2, lifetimeDaysPerChild=24)],
        'maternity': [dict(weeks=16, minServiceMonths=3, noticeWeeks=4,
             childOrder1and2=dict(capPer4WeeksCents=1000000, capTotalCents=2000000),
             childOrder3plus=dict(capPer4WeeksCents=1000000, capTotalCents=4000000), flexibleMaxWorkingDays=48),
             dict(weeks=12, employerPaidWeeks=8)],
        'paternity': [dict(weeks=4, capPerWeekCents=250000, capTotalCents=1000000,
             maxWorkingDaysPerWeek=6, defaultWithinWeeksOfBirth=16), dict(weeks=2, plusVoluntaryWeeks=2)],
        'sharedParental': [dict(weeks=6, capPerWeekCents=250000), dict(weeks=10, capPerWeekCents=250000)],
        'adoption': [dict(weeks=12, childOrder1and2=dict(capTotalCents=2000000),
             childOrder3plus=dict(capTotalCents=3000000), capPer4WeeksCents=1000000)],
    }
    for key, expected in expected_leave.items():
        for i, obj in enumerate(expected):
            source = lv[key][i]['source']
            if key == 'childcareLeave' and i == 1:
                source = 'https://file.go.gov.sg/gpcl2notes.pdf'
            tree(f'leave.{key}[{i}]', lv[key][i], obj, source)
    tax = rules['tax']
    tree('tax', tax, dict(ir21FileAtLeastDaysBefore='ONE_CALENDAR_MONTH',
         ir21ExemptionIncomeBelowCents=2100000), 'https://www.iras.gov.sg/taxes/individual-income-tax/employers/tax-clearance-for-foreign-spr-employees-%28ir21%29/tax-clearance-for-employees')
    tree('tax', tax, dict(aisMandatoryMinEmployees=[dict(minEmployees=5)]),
         'https://www.iras.gov.sg/taxes/individual-income-tax/employers/auto-inclusion-scheme-(ais)-for-employment-income/join-the-auto-inclusion-scheme-(ais)-for-employment-income')
    tree('tax', tax, dict(ir8sDiscontinuedFromYA=2026),
         'https://www.iras.gov.sg/docs/default-source/individual-income-tax/employers/explanatory-notes-on-form-ir8a-and-appendix-8a-for-ya2027.pdf')
    tree('cpfSubmission.lateInterest', rules['cpfSubmission']['lateInterest'],
         dict(ratePerMonthBps=150, minimumCents=500),
         'https://www.cpf.gov.sg/service/article/how-does-cpf-board-calculate-interest-on-late-payment')
    for i, year in enumerate([2026, 2027]):
        check(f'publicHolidays.years[{i}].year', rules['publicHolidays']['years'][i]['year'], year,
              rules['publicHolidays']['years'][i]['sources'][1])
    fixture = rules['employmentAct']['rates']['workingDays2026Fixture']
    for month in range(1, 13):
        days = [calendar.weekday(2026, month, d) for d in range(1, calendar.monthrange(2026, month)[1] + 1)]
        for key, expected in [('fiveDay', sum(d < 5 for d in days)),
                              ('sixDay', sum(d < 6 for d in days)),
                              ('fiveAndHalfDay', str(Decimal(sum(d < 5 for d in days)) + Decimal(sum(d == 5 for d in days)) / 2))]:
            actual = fixture[key][month - 1]
            # The half-day fixture's string formatting is not material.
            if key == 'fiveAndHalfDay':
                expected = format(Decimal(expected).normalize(), 'f')
            check(f'employmentAct.rates.workingDays2026Fixture.{key}[{month - 1}]', actual, expected, fixture['source'])
    return checks


def numeric_inventory(rules, checks):
    verified = {x['path']: x for x in checks}
    leaves = []

    def visit(value, path):
        if isinstance(value, dict):
            for key, val in value.items():
                visit(val, path + '.' + key if path else key)
        elif isinstance(value, list):
            for i, val in enumerate(value):
                visit(val, f'{path}[{i}]')
        elif isinstance(value, (int, Decimal)) and not isinstance(value, bool):
            status = 'MATCH' if path in verified and verified[path]['matches'] else 'DISAGREEMENT' if path in verified else 'NOT_A_STATUTORY_CONSTANT' if path == 'schemaVersion' else 'EXAMPLE_ONLY' if '.ftReference.' in path else 'UNVERIFIED'
            leaves.append(dict(path=path, value=value, status=status))
    visit(rules, '')
    return leaves


def main():
    path = RESEARCH / 'sg-test-vectors.json'
    vectors = json.loads(path.read_text())
    results = []
    for group, compute in [('cpfVectors', cpf), ('sdlVectors', sdl), ('shgVectors', shg_vector)]:
        for vector in vectors[group]:
            result = compute(vector['inputs'])
            differences = {}
            for key, expected in vector['expected'].items():
                actual = result[key]
                match = Decimal(actual) == Decimal(expected) if key == 'sdlExactDollars' else actual == expected
                if not match:
                    differences[key] = dict(theirs=expected, recomputed=actual)
            caveats = []
            if vector['id'] == 'SPR-04':
                caveats.append('2028 is unannounced; conditional arithmetic only, published rate identity is 2027:T1.')
            if vector['id'] == 'AW-11':
                caveats.append('Input calls prior AW reconciliation a new payment; official June AW paid is zero. Correct June SDL is 3.75, not 11.25.')
            results.append(dict(id=vector['id'], provenance=vector['provenance'], recomputed=result,
                                differences=differences, caveats=caveats))
    rules = json.loads((RESEARCH / 'sg-rule-tables.json').read_text())
    checks = audit_tables(rules)
    inventory = numeric_inventory(rules, checks)
    aw11 = next(v for v in vectors['cpfVectors'] if v['id'] == 'AW-11')
    corrected_aw11 = cpf(aw11['inputs'])
    corrected_aw11.update(sdlUnits1e4Cent=sdl_units(150000), sdlExactDollars=dollars(sdl_units(150000)))
    report = dict(inputSha256={name: hashlib.sha256((RESEARCH / name).read_bytes()).hexdigest()
                              for name in ['sg-regulatory.md', 'sg-rule-tables.json', 'sg-test-vectors.json', 'sg-test-vectors.md']},
                  counts=dict(Counter(x['provenance'] for x in results)),
                  vectors=results, tableChecks=checks,
                  tableCheckFailures=[x for x in checks if not x['matches']],
                  numericInventory=inventory,
                  scenarioCorrections={'AW-11': dict(awPaidCents=0, priorAwNowSubjectCents=4000000, expected=corrected_aw11)},
                  addedProbes={'SDL_ZERO_WAGES_PAID_OR_PAYABLE': dict(theirFormulaUnits=2000000, correctUnits=sdl_units(0))})
    (HERE / 'recomputation-results.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(dict(vectors=len(results), provenance=report['counts'],
                          vectorDifferences={x['id']: x['differences'] for x in results if x['differences']},
                          caveats={x['id']: x['caveats'] for x in results if x['caveats']},
                          tableChecks=len(checks), tableCheckFailures=report['tableCheckFailures'],
                          numericCoverage=dict(Counter(x['status'] for x in inventory)),
                          unverifiedNumericLeaves=[x for x in inventory if x['status'] == 'UNVERIFIED']), indent=2))


if __name__ == '__main__':
    main()
