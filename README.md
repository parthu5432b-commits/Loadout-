<!-- LOADOUT_LATEST_APK_START -->
## Latest Android APK

[Download Loadout-Android.apk](https://github.com/parthu5432b-commits/Loadout-/releases/latest/download/Loadout-Android.apk)
<!-- LOADOUT_LATEST_APK_END -->

# Loadout — GitHub APK Build Bundle

This is the **repository root** to upload to your private GitHub repository. Do not upload only the inner payload ZIP.

## How the build works

1. GitHub Actions checks out this repository.
2. `scripts/build.mjs` verifies the payload SHA-256.
3. It extracts `payload/loadout-app-payload.zip` into `.build/loadout-app/`.
4. It reads the deeper `BUILD_INSTRUCTIONS.json` from inside the extracted payload.
5. It installs pinned Capacitor dependencies, generates the Android project, installs/registers the Loadout native bridge, syncs `www/`, and runs Gradle `assembleDebug`.
6. Actions uploads the APK as `Loadout-Android-debug-apk`.

The GitHub Actions YAML, build scripts and architecture documents are outside the payload ZIP. Capacitor's `webDir` is `www`, so these repo/build instructions are not copied into the APK as web assets. The native Java bridge is intentionally compiled into the APK.

## Upload this bundle to GitHub

1. Commit `.github/workflows/build-apk.yml` to the repository's default branch once.
2. Upload the complete `Loadout-GitHub-Build.zip` to the repository and commit it. It can be placed at the root or inside a folder.
3. GitHub Actions validates and extracts the bundle, commits the application source, builds the Android APK and publishes a release.
4. Download the APK from the Actions artifact or the Latest Android APK link at the top of this README.

## Keep the signing identity stable

The workflow creates a debug signing key on the first build and stores it in GitHub Actions cache. No signing-key secret is required. GitHub's default cache retention is 7 days since last access. If the cache is evicted after a long gap, a later APK may have a different signature and Android may reject it as an in-place update. Back up app data before uninstalling an existing installation.

## Do not change these paths without updating BUILD_PLAN.json

```text
.github/workflows/build-apk.yml   GitHub workflow, build-side only
scripts/build.mjs                 Extracts and reads deep instructions
BUILD_PLAN.json                  Outer build instructions
payload/loadout-app-payload.zip   Actual app payload
payload/SHA256SUMS.txt            Payload integrity check
architecture/                     Full L-SEAA specification
```

## UI and existing data

The original Loadout `www/app.js`, styles, layout, assets and chapter datasets are retained. The runtime bootstrap is loaded before the existing app but adds no visible UI. Existing LocalStorage keys and chat history are not migrated/deleted in this milestone.

## What this build establishes

- Native Android `LoadoutCore` bridge for private file-backed storage and runtime information.
- Five storage lifetimes for new modules: volatile, session, module, TTL and persistent.
- Balanced local diagnostic journal with secret-key redaction.
- Advanced, staged transformation engine for managed configuration and trusted web modules.
- Explicit manual commit/rollback decision API.
- Offline cached runtime bootstrap.

## Important scope boundary

This is the first L-SEAA foundation, not the completed self-evolving platform. Arbitrary DEX/JAR/native `.so` hot loading, a signed private registry, ZIP `.lupdate` import inside the app, a wireless development-port UI, and migration of the old app's storage are not enabled yet. The architecture files identify those next milestones. A new APK is still required for native host/manifest/permission changes.

## Troubleshooting

- **No workflow appears:** ensure `.github/workflows/build-apk.yml` is on the default branch.
- **Payload hash mismatch:** re-upload `payload/loadout-app-payload.zip` and its matching `SHA256SUMS.txt` from the same bundle; do not edit one without regenerating the other.
- **Build says missing BUILD_INSTRUCTIONS.json:** upload the whole outer bundle and keep the payload ZIP intact.
- **Gradle failure:** open the failed job and inspect the first error in the `Extract payload...` step; the build diagnostics artifact is uploaded even on failure when available.
- **APK install conflict:** Android may reject an APK signed with a different debug key than the currently installed app. Uninstalling the previous version can erase app-private data. Export a backup first; do not uninstall until data is protected.

## Local build

Requirements: Node.js 22, JDK 21, Android SDK/platform tools and `unzip`. Run:

```bash
node scripts/build.mjs
```

The generated project is in `.build/loadout-app/`; debug APK is under `android/app/build/outputs/apk/debug/`.
