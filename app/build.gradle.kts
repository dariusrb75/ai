plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "dev.offlinechess.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "dev.offlinechess.app"
        minSdk = 26
        targetSdk = 35
        // Bumped so the release-signed build is unambiguously a different file from the
        // v2-only debug APK that failed to install.
        versionCode = 2
        versionName = "1.1"
    }

    // The web client is the single source of truth and lives at the repo root, shared with
    // :tools and the test harness. Pointing assets at it avoids keeping a second copy in sync.
    sourceSets["main"].assets.srcDirs("../web")

    signingConfigs {
        create("sideload") {
            // Keystore path and passwords come from local.properties / -P so the keystore itself
            // is never committed. See dist/README.md for how to regenerate one.
            val keystorePath = (project.findProperty("sideloadKeystore") as String?)
                ?: "../sideload.jks"
            val password = (project.findProperty("sideloadPassword") as String?)
                ?: "offlinechess"

            storeFile = file(keystorePath)
            storePassword = password
            keyAlias = (project.findProperty("sideloadAlias") as String?) ?: "sideload"
            keyPassword = password

            // v1 (JAR signing) is the fix for "App not installed" when sideloading. AGP omits
            // v1 whenever minSdk >= 24, but several OEM package installers — MIUI, Oppo, Vivo,
            // older Samsung — still refuse a v2-only APK with exactly that message.
            enableV1Signing = true
            enableV2Signing = true
            enableV3Signing = true
        }
    }

    buildTypes {
        release {
            // The build that actually gets sideloaded. Release rather than debug because
            // debuggable packages are rejected outright by some hardened OEM builds.
            signingConfig = signingConfigs.getByName("sideload")
            // No shrinking: the app is already tiny, and R8 stripping something NanoHTTPD
            // reaches reflectively is not a risk worth taking for a build nobody can debug
            // in the field.
            isMinifyEnabled = false
        }
        debug {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }

    kotlinOptions {
        jvmTarget = "1.8"
    }

    packaging {
        resources.excludes += setOf("META-INF/*.kotlin_module", "META-INF/LICENSE*")
    }
}

dependencies {
    implementation(project(":core"))
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.zxing.core)
}
