plugins {
    alias(libs.plugins.kotlin.jvm)
    application
}

// Runs :core's server on a desktop JVM against web/ on the filesystem. This exists so the
// protocol and the whole web client can be exercised in CI with no Android device involved.
dependencies {
    implementation(project(":core"))
}

application {
    mainClass.set("dev.offlinechess.tools.MainKt")
}
