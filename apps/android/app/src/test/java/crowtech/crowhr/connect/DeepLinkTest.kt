package crowtech.crowhr.connect

import crowtech.crowhr.Fixtures
import crowtech.crowhr.arr
import crowtech.crowhr.obj
import crowtech.crowhr.str
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** apps/mobile-fixtures/deeplink-cases.json: QR connect links and the sign-in callback. */
class DeepLinkTest {
    private val fixture = Fixtures.load("deeplink-cases.json")

    @Test fun connectLinks() {
        for (case in fixture.arr("connect").map { it.jsonObject }) {
            val expected = case.obj("expected")!!
            val parsed = DeepLinks.parseConnect(case.str("uri")!!)
            val id = case.str("id")
            when (expected.str("result")) {
                "ok" -> {
                    parsed as DeepLinks.Connect.Ok
                    assertEquals("$id server", expected.str("server"), parsed.server)
                    assertEquals("$id org", expected.str("org"), parsed.org)
                }
                else -> assertEquals("$id", DeepLinks.Connect.Invalid, parsed)
            }
        }
    }

    @Test fun oauthRedirects() {
        for (case in fixture.arr("oauthRedirect").map { it.jsonObject }) {
            val expected = case.obj("expected")!!
            val parsed = DeepLinks.parseOAuthRedirect(case.str("uri")!!, case.str("expectedState"))
            val id = case.str("id")
            val want = when (expected.str("result")) {
                "code" -> DeepLinks.Redirect.Code(expected.str("code")!!)
                "error" -> DeepLinks.Redirect.Error(expected.str("error")!!)
                "state_mismatch" -> DeepLinks.Redirect.StateMismatch
                else -> DeepLinks.Redirect.Invalid
            }
            assertEquals("$id", want, parsed)
        }
    }

    @Test fun isOAuthRedirectRecognisesOnlyTheCallback() {
        assertEquals(true, DeepLinks.isOAuthRedirect("crowtech.crowhr:/oauth2redirect?code=a&state=b"))
        assertEquals(false, DeepLinks.isOAuthRedirect("crowhr://connect?server=https%3A%2F%2Fa.example"))
    }
}
