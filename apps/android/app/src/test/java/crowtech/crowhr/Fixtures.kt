package crowtech.crowhr

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Loads a shared fixture from apps/mobile-fixtures (on the unit-test classpath). */
object Fixtures {
    fun load(name: String): JsonObject {
        val stream = Fixtures::class.java.classLoader!!.getResourceAsStream(name)
            ?: error("Fixture $name not found: is apps/mobile-fixtures on the test classpath?")
        return Json.parseToJsonElement(stream.bufferedReader().readText()).jsonObject
    }
}

fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.takeUnless { it is JsonNull }?.contentOrNull
fun JsonObject.obj(key: String): JsonObject? = (this[key] as? JsonObject)
fun JsonObject.arr(key: String): List<JsonElement> = (this[key]?.takeUnless { it is JsonNull })?.jsonArray ?: emptyList()
fun JsonElement.strings(): List<String> = jsonArray.map { it.jsonPrimitive.content }
