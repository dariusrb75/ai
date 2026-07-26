plugins {
    alias(libs.plugins.kotlin.jvm)
}

// Deliberately a plain JVM module. Nothing here may import android.*; that constraint is what
// lets the full game engine and server run under `gradlew :core:test` and `:tools:run` in CI
// with no emulator. The Android app only supplies file/asset access via the two interfaces
// in AssetSource.kt and GameStore.kt.
kotlin {
    compilerOptions {
        // Android's runtime is what constrains us here, not the desktop JVM.
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_1_8)
    }
}

java {
    sourceCompatibility = JavaVersion.VERSION_1_8
    targetCompatibility = JavaVersion.VERSION_1_8
}

dependencies {
    api(libs.nanohttpd)
    api(libs.nanohttpd.websocket)
    implementation(libs.gson)

    testImplementation(libs.junit)
    testImplementation(kotlin("test"))
}

tasks.test {
    testLogging {
        events("passed", "skipped", "failed")
        showStandardStreams = false
    }
}
