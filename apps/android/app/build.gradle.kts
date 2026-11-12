import java.util.Properties
import java.util.zip.ZipFile
import javax.xml.parsers.DocumentBuilderFactory
import org.gradle.api.artifacts.component.ModuleComponentIdentifier
import org.gradle.api.artifacts.result.ResolvedArtifactResult
import org.gradle.maven.MavenModule
import org.gradle.maven.MavenPomArtifact
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.w3c.dom.Element

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "crowtech.crowhr"
    compileSdk { version = release(37) { minorApiLevel = 2 } }
    defaultConfig {
        // Registered with Google Play and Apple: never change it.
        applicationId = "crowtech.crowhr"
        minSdk = 29
        targetSdk = 37
        versionCode = providers.environmentVariable("CROWHR_ANDROID_VERSION_CODE").orElse("2").get().toInt()
        versionName = "1.0.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    // Release signing: scripts/android-release.sh sets CROWHR_SIGNING_PROPERTIES to the private
    // upload-key properties (storeFile, storePassword, keyAlias, keyPassword), kept outside the
    // repo. Without it, release builds are unsigned; debug builds never need it.
    val signingProperties = providers.environmentVariable("CROWHR_SIGNING_PROPERTIES").orNull
        ?.let { file(it) }?.takeIf { it.isFile }
    signingConfigs {
        if (signingProperties != null) {
            create("upload") {
                val secrets = Properties().apply { signingProperties.inputStream().use { load(it) } }
                storeFile = file(secrets.getProperty("storeFile"))
                storePassword = secrets.getProperty("storePassword")
                keyAlias = secrets.getProperty("keyAlias")
                keyPassword = secrets.getProperty("keyPassword")
            }
        }
    }
    buildTypes {
        release {
            if (signingProperties != null) signingConfig = signingConfigs.getByName("upload")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    // Shared mobile fixtures (apps/mobile-fixtures) are read from the unit-test classpath.
    sourceSets["test"].resources.directories.add(rootProject.file("../mobile-fixtures").path)
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    testOptions { unitTests.isReturnDefaultValues = true }
    // Device tests can't press system permission dialogs: grant runtime permissions at install
    // (notably Android 17's ACCESS_LOCAL_NETWORK, which a grant inside a running process doesn't
    // apply to its sockets). The request flows themselves are covered by unit tests.
    installation { installOptions += listOf("-g") }
    lint {
        warningsAsErrors = false
        abortOnError = true
    }
}

kotlin {
    jvmToolchain(21)
    compilerOptions { jvmTarget = JvmTarget.JVM_17 }
}

// Every runtime dependency is listed in README.md "Dependency audit" with whether it can
// transmit data. Adding one means updating that table (Play Data safety depends on it), and
// regenerating the licence notices (./gradlew :app:generateLicenceNotices).
dependencies {
    val bom = platform("androidx.compose:compose-bom:2026.09.00")
    implementation(bom)
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.11.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("androidx.work:work-runtime-ktx:2.12.0")
    // QR scanning: CameraX preview + ZXing decoding, all on-device (no Play Services).
    implementation("androidx.camera:camera-camera2:1.5.1")
    implementation("androidx.camera:camera-lifecycle:1.5.1")
    implementation("androidx.camera:camera-view:1.5.1")
    implementation("com.google.zxing:core:3.5.3")

    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")

    androidTestImplementation(bom)
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
    // Compose pulls an old Espresso that crashes on Android 17; pin the current one.
    androidTestImplementation("androidx.test.espresso:espresso-core:3.7.0")
}

// Third-party notices for the app's "Open-source licences" screen, which shows every file in
// src/main/assets/licences. ThirdParty-Notices.txt there is generated from the release runtime
// classpath: every library that ships in the APK, with its version, the licence its Maven POM (or
// a parent POM) declares, and the text of any NOTICE file inside it (Apache-2.0 section 4(d)).
//
//   ./gradlew :app:generateLicenceNotices   rewrite the file after a dependency change
//   ./gradlew :app:checkLicenceNotices      fail when the file is out of date, or a licence is not
//                                           one of the reviewed ones below
//
// checkLicenceNotices runs in `check`, in scripts/android-build.sh check and before every release
// build (preReleaseBuild), so a dependency change can't ship with a stale list. Reads POMs and
// jars from the Gradle cache. Everything is inside `run {}` on purpose: Android lint's build-script
// check crashes on top-level declarations of a script, and on a separate applied script file.
run {
    val noticesFile = file("src/main/assets/licences/ThirdParty-Notices.txt")
    // SPDX id -> the full licence text shipped next to the notices. A library under any other
    // licence fails the check until someone reviews it (no copyleft in the app) and adds its text.
    val reviewedLicences = mapOf("Apache-2.0" to "Apache-2.0.txt")

    fun spdxOf(name: String, url: String): String? = when {
        Regex("(?i)apache").containsMatchIn(name) && Regex("2\\.0").containsMatchIn(name) -> "Apache-2.0"
        url.contains("apache.org/licenses/LICENSE-2.0") -> "Apache-2.0"
        Regex("\\bMIT\\b").containsMatchIn(name) -> "MIT"
        else -> null
    }

    fun Element.childElements(tag: String): List<Element> =
        (0 until childNodes.length).map { childNodes.item(it) }.filterIsInstance<Element>().filter { it.tagName == tag }

    fun Element.childText(tag: String): String = childElements(tag).firstOrNull()?.textContent?.trim().orEmpty()

    fun pomOf(group: String, module: String, version: String): File =
        dependencies.createArtifactResolutionQuery()
            .forModule(group, module, version)
            .withArtifacts(MavenModule::class.java, MavenPomArtifact::class.java)
            .execute()
            .resolvedComponents
            .flatMap { it.getArtifacts(MavenPomArtifact::class.java) }
            .filterIsInstance<ResolvedArtifactResult>()
            .firstOrNull()?.file
            ?: throw GradleException("No POM found for $group:$module:$version")

    // The licences a POM declares, following <parent> when it declares none (ZXing, Guava).
    fun licencesOf(group: String, module: String, version: String, depth: Int = 0): List<Pair<String, String>> {
        val root = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(pomOf(group, module, version)).documentElement
        val declared = root.childElements("licenses").flatMap { it.childElements("license") }
            .map { it.childText("name") to it.childText("url") }
        if (declared.isNotEmpty() || depth > 4) return declared
        val parent = root.childElements("parent").firstOrNull() ?: return emptyList()
        return licencesOf(parent.childText("groupId"), parent.childText("artifactId"), parent.childText("version"), depth + 1)
    }

    fun renderNotices(): String {
        val type = Attribute.of("artifactType", String::class.java)
        val artifacts = configurations.getByName("releaseRuntimeClasspath").incoming
            .artifactView { attributes { attribute(type, "jar") } }
            .artifacts.artifacts
        val libraries = artifacts
            .mapNotNull { a -> (a.id.componentIdentifier as? ModuleComponentIdentifier)?.let { it to a.file } }
            .groupBy({ it.first.displayName }) { it }
            .map { (_, entries) -> entries.first().first to entries.map { it.second } }
            .sortedWith(compareBy({ it.first.group }, { it.first.module }))
        val problems = mutableListOf<String>()
        val byLicence = sortedMapOf<String, MutableList<String>>()
        val notices = mutableListOf<String>()
        for ((id, files) in libraries) {
            val declared = licencesOf(id.group, id.module, id.version)
            val reviewed = declared.mapNotNull { (name, url) -> spdxOf(name, url) }.firstOrNull { it in reviewedLicences }
            if (reviewed == null) {
                val names = declared.ifEmpty { listOf("none declared" to "") }.joinToString { it.first }
                problems += "${id.displayName}: licence $names is not reviewed"
                continue
            }
            byLicence.getOrPut(reviewed) { mutableListOf() } += "${id.group}:${id.module} ${id.version}"
            for (f in files) ZipFile(f).use { zip ->
                zip.entries().asSequence()
                    .filter { !it.isDirectory && it.name.substringAfterLast('/').uppercase().startsWith("NOTICE") }
                    .sortedBy { it.name }
                    .forEach { e ->
                        val text = zip.getInputStream(e).bufferedReader().readText().trim()
                        notices += "${id.group}:${id.module} ${id.version} (${e.name}):\n$text"
                    }
            }
        }
        if (problems.isNotEmpty()) {
            throw GradleException("Unreviewed licences on the release classpath (apps/android/app/build.gradle.kts):\n  " + problems.joinToString("\n  "))
        }
        return buildString {
            appendLine("Third-party libraries in Crow HR for Android")
            appendLine()
            appendLine("Crow HR is MIT-licensed (CrowHR-MIT.txt). The app also contains the libraries below,")
            appendLine("unmodified, each under its own licence. The full text of each licence is a separate")
            appendLine("entry on this screen. Generated from the release build's dependencies by")
            appendLine("apps/android/app/build.gradle.kts (generateLicenceNotices); do not edit by hand.")
            for ((licence, modules) in byLicence) {
                appendLine()
                appendLine("$licence (full text: ${reviewedLicences.getValue(licence)}), ${modules.size} libraries:")
                modules.forEach { appendLine("  $it") }
            }
            if (notices.isNotEmpty()) {
                appendLine()
                appendLine("NOTICE files shipped by these libraries:")
                notices.forEach { appendLine(); appendLine(it) }
            }
        }
    }

    tasks.register("generateLicenceNotices") {
        group = "licences"
        description = "Writes src/main/assets/licences/ThirdParty-Notices.txt from the release runtime classpath."
        doLast {
            noticesFile.writeText(renderNotices())
            println("Wrote $noticesFile")
        }
    }

    tasks.register("checkLicenceNotices") {
        group = "verification"
        description = "Fails when ThirdParty-Notices.txt does not match the release runtime classpath."
        doLast {
            val missingTexts = reviewedLicences.values.filterNot { file("src/main/assets/licences/$it").isFile }
            if (missingTexts.isNotEmpty()) throw GradleException("Missing licence texts in src/main/assets/licences: $missingTexts")
            if (!noticesFile.isFile || noticesFile.readText() != renderNotices()) {
                throw GradleException(
                    "ThirdParty-Notices.txt is out of date with the release dependencies. " +
                        "Run ./gradlew :app:generateLicenceNotices and review the change.",
                )
            }
        }
    }

    tasks.matching { it.name == "check" || it.name == "preReleaseBuild" }.configureEach { dependsOn("checkLicenceNotices") }
}
