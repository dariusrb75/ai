pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "offline-chess"

// :core is pure JVM Kotlin with no Android dependencies, so the entire server and game
// engine can be run and unit-tested on a desktop/CI machine without an emulator.
include(":core")

// :tools runs :core's server headlessly against web/ on the filesystem. This is what makes
// the whole thing testable without two phones.
include(":tools")

// :app is a thin Android wrapper around :core.
include(":app")
