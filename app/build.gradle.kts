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
        versionCode = 1
        versionName = "1.0"
    }

    // The web client is the single source of truth and lives at the repo root, shared with
    // :tools and the test harness. Pointing assets at it avoids keeping a second copy in sync.
    sourceSets["main"].assets.srcDirs("../web")

    buildTypes {
        release {
            // No shrinking: the app is already tiny, and R8 stripping something NanoHTTPD
            // reaches reflectively is not a risk worth taking for a build nobody can debug
            // in the field.
            isMinifyEnabled = false
        }
        debug {
            // Debug is the build that actually gets sideloaded, since it needs no keystore.
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
