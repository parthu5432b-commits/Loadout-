# Native-first extension architecture and security boundary

Milestone 1 includes a Capacitor-native Java bridge registered in `MainActivity`. It provides app-private, namespace/key-scoped file operations and runtime information. No broad storage permission is requested.

Future native extension packages should declare module ID/version, required runtime API, Android API range, exported capabilities, permissions, dependencies, integrity hashes, signer identity and lifecycle hooks. Native extensions are privileged host code. A DEX/JAR loaded through a class loader is not an isolation boundary and inherits the host process permissions. Do not execute arbitrary native packages merely because their hash matches.

The next native-loader milestone must include signature verification against pinned first-party keys, immutable staging files, read-only handling before dynamic loading where required by Android, dependency/API checks, class-loader lifecycle, process restart policy, recovery handoff and tested APK fallback. APK-level permission/component changes continue to require a newly built and installed APK.
