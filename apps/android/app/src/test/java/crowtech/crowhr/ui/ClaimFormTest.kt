package crowtech.crowhr.ui

import crowtech.crowhr.api.ClaimActions
import crowtech.crowhr.api.ClaimDetail
import crowtech.crowhr.api.ClaimLine
import crowtech.crowhr.api.ClaimReceipt
import crowtech.crowhr.api.ClaimTypeOption
import crowtech.crowhr.api.FxWarning
import crowtech.crowhr.api.Receipt
import crowtech.crowhr.core.CrowJson
import crowtech.crowhr.ui.screens.ClaimForm
import crowtech.crowhr.ui.screens.ClaimLineValues
import crowtech.crowhr.ui.screens.claimStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The claim form: foreign currency, receipts, totals, and a saved draft back in the form. */
class ClaimFormTest {
    private val taxi = ClaimTypeOption("t-taxi", "transport", "Transport", "transport", receiptRule = "above", receiptAboveCents = 5000)
    private val meal = ClaimTypeOption("t-meal", "entertainment", "Client entertainment", "entertainment", receiptRule = "always")
    private fun line(amount: String, currency: String = "SGD", rate: String = "", type: ClaimTypeOption? = taxi, receipts: Int = 0) = ClaimLineValues(
        type = type, date = "2026-11-10", merchant = "Grab", amount = amount, currency = currency, rate = rate,
        receipts = List(receipts) { Receipt("r$it", "receipt-$it.jpg") },
    )

    private fun ok(v: ClaimLineValues, submit: Boolean = true) = (ClaimForm.check(v, submit) as ClaimForm.Check.Ok).line
    private fun problem(v: ClaimLineValues, submit: Boolean = true) = (ClaimForm.check(v, submit) as ClaimForm.Check.Problem).message

    @Test fun sgdLinesSendCentsAndNoRate() {
        val l = ok(line("S$45.80"))
        assertEquals(4580, l.amountMinor)
        assertEquals("SGD", l.currency)
        assertNull(l.rate)
        assertEquals("Transport", l.description)
    }

    @Test fun foreignLinesSendTheirMinorUnitsAndTheRate() {
        val l = ok(line("125.50", "MYR", " 0.301234 "))
        assertEquals(12_550, l.amountMinor)
        assertEquals("MYR", l.currency)
        assertEquals("0.301234", l.rate)
        assertEquals(5000L, ok(line("5,000", "JPY", "0.008912")).amountMinor)
    }

    @Test fun theSgdPreviewAndTotalMatchTheServer() {
        assertEquals(3780L, ClaimForm.sgdCents(line("125.50", "MYR", "0.301234")))
        assertNull(ClaimForm.sgdCents(line("125.50", "MYR", "")))
        assertNull(ClaimForm.sgdCents(line("12.5x", "MYR", "0.3")))
        assertEquals(4580L, ClaimForm.sgdCents(line("45.80")))
        // Incomplete lines count as nothing; the rest are summed after rounding each.
        assertEquals(3780L + 4580L, ClaimForm.total(listOf(line("125.50", "MYR", "0.301234"), line("45.80"), line("", "USD", "1.35"))))
    }

    @Test fun problemsSayHowToFixThem() {
        assertEquals("Choose what this expense was for.", problem(line("10", type = null)))
        assertEquals("Enter where you paid (the shop or company).", problem(line("10").copy(merchant = " ")))
        assertEquals("Use at most 2 decimal places (cents).", problem(line("10.555")))
        assertEquals("Enter an amount above zero.", problem(line("0")))
        assertEquals("Enter a whole amount in JPY, such as 5000.", problem(line("50.5", "JPY", "0.0089")))
        assertEquals("Enter the amount in KWD with at most 3 decimal places, such as 45.60.", problem(line("1.2345", "KWD", "4.4")))
        assertEquals(
            "Enter the rate as S$ per 1 MYR, with up to 6 decimal places (for example 0.301234).",
            problem(line("125.50", "MYR", "0.3012345")),
        )
    }

    @Test fun receiptsAreNeededOnlyToSubmit() {
        assertEquals("Add a photo of the receipt.", problem(line("12", type = meal)))
        assertTrue(ClaimForm.check(line("12", type = meal), submit = false) is ClaimForm.Check.Ok)
        assertTrue(ClaimForm.check(line("12", type = meal, receipts = 1), submit = true) is ClaimForm.Check.Ok)
        // "Above S$50": the S$ amount decides, also for a foreign line.
        assertTrue(ClaimForm.check(line("50"), submit = true) is ClaimForm.Check.Ok)
        assertEquals("Add a photo of the receipt (needed above S$50.00).", problem(line("50.01")))
        assertEquals("Add a photo of the receipt (needed above S$50.00).", problem(line("200", "MYR", "0.301234")))
        assertTrue(ClaimForm.check(line("100", "MYR", "0.301234"), submit = true) is ClaimForm.Check.Ok)
    }

    private val draft = ClaimDetail(
        id = "c1", status = "draft", title = "Penang trip", totalCents = 8360,
        lines = listOf(
            ClaimLine(
                id = "l1", claimTypeId = "t-taxi", typeCode = "transport", typeName = "Transport", expenseDate = "2026-11-03",
                merchant = "Grab", description = "Transport", currency = "MYR", amountMinor = 12_550, rate = "0.301234", sgdCents = 3780,
                receipts = listOf(ClaimReceipt("f1", "grab.jpg", "image/jpeg", 1000), ClaimReceipt("f2", "old.jpg", removed = true)),
            ),
            ClaimLine(
                id = "l2", claimTypeId = "t-archived", typeCode = "phone", typeName = "Phone bill", category = "phone",
                expenseDate = "2026-11-04", merchant = "Singtel", description = "October bill", amountMinor = 4580, sgdCents = 4580,
            ),
        ),
        actions = ClaimActions(edit = true, submit = true, delete = true),
    )

    @Test fun aSavedDraftComesBackIntoTheFormAsTyped() {
        val lines = ClaimForm.fromClaim(draft, listOf(taxi, meal))
        assertEquals(2, lines.size)
        val myr = lines[0]
        assertEquals(taxi, myr.type)
        assertEquals("2026-11-03", myr.date)
        assertEquals("125.50", myr.amount)
        assertEquals("MYR", myr.currency)
        assertEquals("0.301234", myr.rate)
        // The type's own name was filled in for an empty description; it shows empty again.
        assertEquals("", myr.description)
        // Removed receipts don't come back.
        assertEquals(listOf("f1"), myr.receipts.map { it.id })
        // A type no longer offered keeps its name, so the line still reads right.
        assertEquals("Phone bill", lines[1].type!!.name)
        assertEquals("t-archived", lines[1].type!!.id)
        assertEquals("45.80", lines[1].amount)
        assertEquals("", lines[1].rate)
        assertEquals("October bill", lines[1].description)
        // Saved again unchanged, it sends what the server holds.
        assertEquals(12_550L, ok(myr).amountMinor)
        assertEquals("0.301234", ok(myr).rate)
        assertEquals(listOf("f1"), ok(myr).receiptIds)
        assertEquals(4580L, ok(lines[1]).amountMinor)
        assertEquals(draft.totalCents, ClaimForm.total(lines))
    }

    @Test fun claimDetailsFromTheServerDecode() {
        val json = """
            {"id":"c1","claimNumber":null,"status":"draft","title":null,"employee":{"id":"e1","name":"Ahmad","employeeNumber":"E1","departmentName":null},
             "totalCents":3780,"gstCents":0,"payoutMethod":null,"approvalRequestId":null,"submittedAt":null,"decidedAt":null,"approvedOn":null,
             "decisionComment":null,"reservedByPayrollRun":false,"paidVia":null,"paidOn":null,"paidReference":null,"copiedFromClaimId":null,
             "createdAt":"2026-11-13T01:00:00.000Z","updatedAt":"2026-11-13T01:00:00.000Z",
             "lines":[{"id":"l1","position":0,"claimTypeId":"t1","typeCode":"transport","typeName":"Transport","category":"transport",
               "expenseDate":"2026-11-03","merchant":"Grab","description":"","receipts":[{"id":"f1","name":"r.jpg","mime":"image/jpeg","sizeBytes":10,
               "scanStatus":"clean","removed":false,"previewable":true,"url":"/x","uploadedAt":"2026-11-13T01:00:00.000Z"}],"receiptCount":1,
               "currency":"MYR","amountMinor":12550,"rate":"0.301234","sgdCents":3780,"gstCents":null,"receiptRequired":false,"duplicates":[]}],
             "capUsage":[],"actions":{"edit":true,"submit":true,"delete":true,"withdraw":false,"copy":false}}
        """.trimIndent()
        val c = CrowJson.decodeFromString(ClaimDetail.serializer(), json)
        assertTrue(c.actions.edit && c.actions.submit && c.actions.delete)
        assertFalse(c.actions.withdraw || c.actions.copy)
        assertEquals(3780L, c.lines.single().sgdCents)
        // An older server without `actions` allows nothing in the app.
        val old = CrowJson.decodeFromString(ClaimDetail.serializer(), """{"id":"c1","status":"draft","totalCents":1,"lines":[]}""")
        assertEquals(ClaimActions(), old.actions)
    }

    @Test fun theExchangeRateWarningAsTheWebWordsIt() {
        val line = draft.lines[0].copy(rate = "0.380000", fxWarning = FxWarning("0.301234", "2026-11-01", 2615))
        assertEquals(
            "MYR 0.380000 is 26.15% above the last MYR rate used in your organisation, 0.301234 on 1 Nov 2026.",
            ClaimForm.fxWarningText(line, 0, 1),
        )
        val below = line.copy(fxWarning = FxWarning("0.301234", "2026-11-01", -2001))
        assertEquals(
            "Item 2: MYR 0.380000 is 20.01% below the last MYR rate used in your organisation, 0.301234 on 1 Nov 2026.",
            ClaimForm.fxWarningText(below, 1, 2),
        )
        assertNull(ClaimForm.fxWarningText(draft.lines[1], 1, 2))
        val decoded = CrowJson.decodeFromString(
            ClaimLine.serializer(),
            """{"claimTypeId":"t","expenseDate":"2026-11-03","currency":"MYR","amountMinor":100,"rate":"0.4","sgdCents":40,
               "fxWarning":{"lastRate":"0.301234","lastRateOn":"2026-11-01","deviationBasisPoints":3279}}""",
        )
        assertEquals(3279L, decoded.fxWarning!!.deviationBasisPoints)
    }

    @Test fun statusWording() {
        assertEquals("Draft", claimStatus("draft").first)
        assertEquals("Waiting for approval", claimStatus("submitted").first)
        assertEquals("Withdrawn", claimStatus("withdrawn").first)
    }
}
