package crowtech.crowhr.auth

import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/** RFC 7636 PKCE with S256 (the only method the server accepts). */
object Pkce {
    data class Pair(val verifier: String, val challenge: String)

    private val random = SecureRandom()
    private val encoder = Base64.getUrlEncoder().withoutPadding()

    /** 32 random bytes → a 43-character base64url verifier. */
    fun generate(): Pair {
        val verifier = encoder.encodeToString(ByteArray(32).also(random::nextBytes))
        return Pair(verifier, challengeFor(verifier))
    }

    fun challengeFor(verifier: String): String =
        encoder.encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)))

    /** 24 random bytes → 32 characters; the server accepts 8–200. */
    fun newState(): String = encoder.encodeToString(ByteArray(24).also(random::nextBytes))
}
