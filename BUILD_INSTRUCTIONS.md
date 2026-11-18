# Build instructions (outer repository)

The canonical build procedure is `scripts/build.mjs`. Do not manually unzip payload assets into the repository root. The script checks `BUILD_PLAN.json`, verifies the archive digest, unpacks the inner ZIP, reads `loadout-app/BUILD_INSTRUCTIONS.json`, checks that `appId` and `webDir` match Capacitor configuration, injects the native plugin and performs the APK build.

The inner instructions are declarative and versioned. The orchestrator validates expected paths and only runs the predefined build commands; it does not execute commands read from the inner JSON. This avoids making the payload an arbitrary shell-script execution mechanism.
