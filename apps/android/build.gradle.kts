// Toolchain, verified stable on maven.google.com / Maven Central in Nov 2026: AGP 9.4.1 with
// built-in Kotlin, Kotlin Compose and serialization plugins 2.4.21, Gradle 9.8.1 (wrapper with
// the official distribution SHA-256 pinned).
plugins {
    id("com.android.application") version "9.4.1" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.4.21" apply false
    id("org.jetbrains.kotlin.plugin.serialization") version "2.4.21" apply false
}
