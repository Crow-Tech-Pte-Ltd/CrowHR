import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "crowtech.crowhr"
    compileSdk { version = release(37) { minorApiLevel = 2 } }
    defaultConfig {
        // Registered in Play Console (app 4976368088435434771) and with Apple, 7 Nov 2026.
        applicationId = "crowtech.crowhr"
        minSdk = 29
        targetSdk = 37
        versionCode = providers.environmentVariable("CROWHR_ANDROID_VERSION_CODE").orElse("1").get().toInt()
        versionName = "0.1.0"
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
// transmit data. Adding one means updating that table (Play Data safety depends on it).
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
