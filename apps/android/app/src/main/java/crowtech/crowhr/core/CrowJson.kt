package crowtech.crowhr.core

import kotlinx.serialization.json.Json

/**
 * Lenient decoding (add-mobile-apps design decision 1): unknown fields are ignored, so a newer
 * server never breaks an older app. Enums from the server are decoded as strings.
 */
val CrowJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
    encodeDefaults = true
}
