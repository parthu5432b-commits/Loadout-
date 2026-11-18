# Loadout Self-Evolving Application Architecture (L-SEAA)

**Specification version:** 1.0  
**Implementation baseline:** Loadout JEE static Capacitor app  
**Runtime foundation in this bundle:** 0.1.0 / runtime API 1.0.0  
**Status:** phased implementation; this document distinguishes implemented behaviour from later work.

## 1. Locked architectural decisions

| Area | Decision | Consequence |
|---|---|---|
| Distribution | Private registry; first-party modules only initially | No public extension marketplace or third-party extension trust model in the first versions |
| Offline | Installed modules remain usable offline wherever their capability allows | Runtime, module source, module metadata and managed state are stored locally; network-only AI endpoints remain network-dependent |
| Transformations | **Advanced** | Whole-module replacement, structured JSON changes and guarded source-level patches are permitted |
| Rollback | **Manual** | A validated update waits for an explicit owner decision. Activation failure still triggers immediate recovery |
| Diagnostics | **Balanced** | Retain errors, warnings, update/recovery events and useful build identity; do not log every routine event or private chat content |
| Native architecture | **Native-first** | Android host services, private storage and native extension contracts form the foundation; web modules remain supported |

## 2. Design objective

Loadout is to evolve from a mostly monolithic web application inside a Capacitor Android shell into a modular, locally controlled system. Features, storage policies, runtime services and selected native extensions should be upgradeable as independently versioned units. Changes must be inspectable, staged, validated, manually committed, and recoverable.

The architecture must not assume that the app can bypass Android's package/signing/process/storage rules. A private deployment removes the need to target Play Store distribution, but it does not remove Android platform restrictions.

## 3. System layers

### 3.1 Permanent recovery foundation / Android host

Responsibilities:
- Own the Android package identity and signing relationship.
- Bootstrap the WebView and Capacitor bridge.
- Expose only narrow app-private native services.
- Provide a known-good starting application if a replaceable runtime fails.
- Register compiled native extensions and coordinate their lifecycle.
- Hand APK replacement to Android's package installer when a host-level change is required.

This layer is intentionally difficult to replace. A new manifest permission, Android component, package identity, native library or bootstrap change requires a new APK and Android installation/update flow.

**Implemented now:** the Capacitor host plus `LoadoutCorePlugin`, registered in `MainActivity`, with runtime information and namespace/key-scoped app-private file read/write/delete/list methods.

**Not implemented yet:** an independently replaceable recovery APK, signed DEX/JAR loader, dynamic `.so` loader or seamless host handover.

### 3.2 Replaceable JavaScript runtime

Responsibilities:
- Stable module API and lifecycle.
- Module activation/deactivation and dependency checks.
- Event bus and navigation/service integration points.
- Managed storage and cache lifetime policies.
- Update transaction and transformation manager.
- Diagnostics and development-port API.

**Implemented now:** `window.Loadout` runtime API, event bus, managed storage, diagnostics, staged update manager and local module import/activation contract. This is loaded before the legacy `app.js` without changing its visible interface.

**Next:** progressively extract legacy feature code behind stable module contracts. Do not replace the working app wholesale.

### 3.3 Feature modules

Each module declares:
- Stable module ID and semantic version.
- Runtime API compatibility range.
- Entry point and content hash.
- Dependencies and capabilities consumed/provided.
- Storage namespaces read/written.
- Events published/subscribed.
- Install, activate, deactivate and migration hooks.
- Offline capability statement.

Web modules are self-contained ES modules loaded from app-private storage. In the first runtime implementation, an extension should export `activate(api)` (or `install(api)`) and may return a cleanup function. Avoid relative imports in this first loader; use the supplied API until a versioned module resolver is implemented.

### 3.4 Native extensions

Native extensions use Java/Kotlin interfaces compiled into the Android host. Native code has host-process privileges. It is not sandboxed just because it is separately packaged.

A future dynamic native loader must require a pinned first-party signer, immutable staging, dependency/API checks, compatible Android API range, lifecycle and process-restart policy, and a recovery fallback. A hash proves content integrity, not who authored the code.

**Implemented now:** a native Capacitor bridge and scoped native storage service. Arbitrary native code is not loaded at runtime yet.

### 3.5 Storage subsystem

All new modules should use the central storage facade rather than making ad hoc storage choices. Lifetimes:

| Lifetime | Backing | Expiry |
|---|---|---|
| `volatile` | In-memory | When process/runtime memory is discarded |
| `session` | `sessionStorage` | When the WebView session ends |
| `module` | In-memory module namespace | On module deactivation |
| `ttl` | Persistent native/browser store with expiry metadata | On next read after expiry; cleanup is lazy |
| `persistent` | Android app-private files; browser `localStorage` fallback | Until explicit deletion/migration |

Example:

```js
const preview = await Loadout.storage.create({
  namespace: 'question-viewer',
  name: 'current-preview',
  lifetime: 'module',
  moduleId: 'loadout.question-viewer'
});
await preview.set({ questionId: 'jee-2025-001' });
```

A module-lifecycle cache is cleared through `Loadout.storage.deactivateModule(moduleId)`. `volatile` and `module` data are never written to disk. TTL expiry is checked and removed when read; background expiry scheduling is not part of this milestone.

**Data preservation rule:** no policy change may silently delete user data. Persistent-to-session or persistent-to-module changes require an explicit retention decision, backup/snapshot, migration, validation and only then removal of obsolete records. The existing keys `loadout-jee-2027-v1`, `loadout_chat_v2` and legacy chat data are not migrated by this first build.

### 3.6 Update and transformation engine

Responsibilities:
- Verify target app/runtime and package integrity.
- Build a dependency and impact plan.
- Snapshot active module registry and managed configuration.
- Stage code/transforms separately from the live runtime.
- Apply transformations to staged copies only.
- Validate module hashes, preconditions and managed configuration.
- Wait for explicit manual commit or rollback.
- Keep transaction history and recover failed activation.

### 3.7 Observatory / diagnostics

Balanced instrumentation records:
- Runtime/native host identity and version.
- Warnings and exceptions.
- Module installation/activation/deactivation failures.
- Transformation precondition failures.
- Update transaction, commit, rollback and recovery outcomes.
- Build ID, Git commit, payload hash and schema/runtime version.

It does **not** record routine per-render events, every storage read, AI prompts, chat contents, passwords, API keys or authorization headers. Secret-like fields are redacted before journal writes. Detailed source-level debugging is obtained from the exact unminified source/build in the private repository and the transaction/build identity.

### 3.8 Development Port

The port will eventually provide pairing, package transfer, dependency/impact inspection, source/module inspector, runtime logs, storage inspection, native debugging, tests and APK handoff.

**Implemented now:** a local runtime API surface callable from a trusted WebView console/harness:

```js
await Loadout.port.status();
await Loadout.port.stageUpdate(packageObject);
await Loadout.port.commit(transactionId);
await Loadout.port.rollback(transactionId);
```

No network listener, LAN command endpoint or visible UI panel has been added yet. Do not expose this API to unauthenticated network callers.

### 3.9 Private registry

The target registry is first-party and private. It should publish immutable versioned packages, signed manifests, dependencies, content hashes, migration requirements and compatibility metadata. Installed modules should be cached locally so a registry outage does not disable installed offline-capable features.

**Not implemented yet:** registry server/client, authentication, package ZIP reader in the app, digital signature verification and offline package synchronization protocol.

## 4. Update levels

| Level | What changes | Delivery |
|---|---|---|
| 1 — Web module | Feature logic/UI module, data/config under the managed runtime | `.lupdate`/module package staged in app-private storage |
| 2 — Runtime/native service | Runtime APIs, bridge implementation, native Java/Kotlin code, native libraries | New APK build/install, or future separately verified native loader where technically safe |
| 3 — Android host | Manifest, permissions, components, package/signing/bootstrap | New APK and Android package installer |

The update engine must identify the required level before applying changes. A module cannot grant itself Android permissions that the host did not declare or obtain.

## 5. Loadout Transformation Language (LTL)

LTL is a constrained declarative operation set, not arbitrary shell access. It supports whole module replacement, structured state operations and carefully guarded source-level patches.

| Operation | Purpose | Milestone-1 implementation |
|---|---|---|
| `ADD` | Add a managed JSON property | Yes |
| `REPLACE` | Replace an existing managed JSON property | Yes |
| `PATCH` | Set/append/remove a managed JSON property | Yes |
| `REMOVE` | Remove a managed JSON property | Yes |
| `MOVE` / `RENAME` | Move a managed JSON property to another path | Yes; same underlying move semantics |
| `RECONFIGURE` | Change managed runtime settings | Yes |
| `CHANGE_POLICY` | Change managed storage/runtime policy metadata | Yes |
| `MIGRATE` | Apply an ordered set of nested JSON operations | Yes; no arbitrary migration script execution |
| `INSTALL_DEPENDENCY` / `REMOVE_DEPENDENCY` | Update managed dependency declarations | Yes; dependency resolution remains minimal |
| `PATCH_SOURCE` | Exact source-anchor transformation on staged JS files | Yes; guarded by hashes and match count |
| `VALIDATE` | Explicit validation marker/additional test request | Recognized marker; automated test-suite execution is still future work |
| `ACTIVATE` | Activation intent marker | Recognized marker; actual activation occurs only through explicit `commit(txId)` |

### 5.1 JSON operation example

```json
{
  "op": "RECONFIGURE",
  "path": "/chat/cacheLifetime",
  "value": "session"
}
```

Managed JSON operations use JSON Pointer-style paths. Root replacement is not allowed. Operations run against a staged configuration snapshot, not the legacy JEE progress or chat stores.

### 5.2 Advanced source patch example

```json
{
  "op": "PATCH_SOURCE",
  "file": "modules/example.js",
  "expectedSha256": "<sha256-of-exact-current-file>",
  "anchor": "const CACHE_LIFETIME = 'persistent';",
  "replacement": "const CACHE_LIFETIME = 'session';",
  "expectedOccurrences": 1,
  "resultSha256": "<optional-sha256-of-result>"
}
```

Restrictions:
- File must be a staged JavaScript file under `modules/` or `extensions/web/`.
- The exact preimage SHA-256 must match.
- The exact anchor must occur the declared number of times (one by default).
- An optional postimage SHA-256 is checked after patching.
- Source is changed in the staged copy only; currently executing files are never overwritten in place.
- The resulting module hash is recalculated before activation.
- No arbitrary paths, shell commands or unrestricted filesystem access are accepted.

## 6. Update package and transaction contract

A future `.lupdate` ZIP contains `update.json`, module files, transformations, migrations, tests, hash list and signatures. The current runtime entry point accepts a decoded `{ manifest, files }` object; an in-app ZIP decoder and signature verifier are still pending.

Minimum manifest fields:

- `formatVersion: "1.0"`
- `updateId`
- `target.appId` and `target.version`
- `runtimeApi`
- `modules[]` with `id`, `version`, `entry`, `sha256`
- `transformations[]`
- dependency, migration, validation and rollback metadata as needed

Current runtime checks app ID, runtime API, safe file paths, source size, module entry and hashes. It caps each staged source file at 4 MiB and total staged source at 8 MiB.

### Transaction state machine

```text
INSPECTED → PLANNED → SNAPSHOTTED → STAGED → TRANSFORMED → VALIDATED
                                                        ↓
                                           AWAITING_MANUAL_DECISION
                                             ↙                 ↘
                                      ROLLBACK               COMMIT
                                                                  ↓
                                                              ACTIVATED
                                                                  ↓
                                               optional manual rollback
```

Current observable states include `awaiting-manual-decision`, `committed`, `rolled-back` and `activation-failed`.

Manual means the runtime never commits merely because basic checks passed. Activation exceptions still restore the previous module registry/configuration automatically; that is failure containment, not a user decision override.

### Rollback semantics

- A staged update can be discarded without touching active state.
- A committed update can restore its previous module registry and managed configuration.
- Module-owned data is preserved, not deleted, during code rollback.
- A rollback cannot magically reverse non-reversible data migrations. Such migrations require a retained snapshot, reverse migration, compatibility adapter or forward recovery.
- Keep the previous known-good code until the candidate passes health checks.

## 7. Runtime and storage versioning

Every package declares a runtime API version and dependency compatibility. Modules declare API requirements and service contracts. Runtime changes that break a module contract must either migrate the module, provide a compatibility adapter or be rejected.

Version slots should retain:
- Active version.
- Previous known-good version.
- Recovery/bootstrap version.
- Version metadata, hashes and dependency graph.
- Transaction journal and migration metadata.

Disk cleanup may prune redundant downloads but must not delete the only recovery copy or user data still referenced by an active module.

## 8. Impact analysis and dependency graph

Each module/service should eventually declare:
- APIs provided and consumed.
- Storage namespaces/entities read and written.
- Events published and subscribed.
- Native permissions/capabilities required.
- Runtime version and dependency constraints.

The planner builds an impact graph before mutation. For example, a chat-storage change may affect chat UI, session/context manager, provider settings, native storage, backup/restore, migration code and tests. The impact report identifies tests and backups required before commit.

**Milestone 1:** only checks module source hashes and staged managed configuration preconditions. A complete graph-based impact analyzer is future work.

## 9. Testing policy

Five layers are required as the system matures:
1. Static: syntax, imports, API version, package integrity and dependency checks.
2. Component: unit tests and contract tests.
3. Integration: module communication, storage API, event bus and native bridge.
4. System: app startup, navigation, offline operation, resource use and recovery.
5. Data: record counts, schemas, migration correctness and retention invariants.

Shadow testing compares old/new module outputs for shared inputs where practical. Deterministic calculators should match exact expected values; AI outputs are evaluated against structural/quality constraints rather than byte-for-byte identity.

## 10. Build and repository boundary

The repository's outer bundle contains GitHub workflow YAML, build scripts, build plan, instructions and architecture documents. The inner `loadout-app-payload.zip` contains the application source plus a deeper `BUILD_INSTRUCTIONS.json`. The GitHub build script:
1. Verifies the payload checksum.
2. Unzips the inner application payload.
3. Reads and validates deeper instructions.
4. Installs pinned Capacitor dependencies.
5. Generates the Android project and registers the native bridge.
6. Copies only `www/` as WebView assets and builds the debug APK.

`capacitor.config.json` uses `webDir: "www"`. Build-side `.yml`, orchestration scripts and architecture documentation remain outside `www/` and are not added as web assets to the APK. Native Java source is intentionally compiled into the APK.

The package ID remains `app.loadout.jee`; this bundle sets `versionCode` 2 and `versionName` 1.1.0. The GitHub runner's debug signing key is not persistent unless the optional `LOADOUT_DEBUG_KEYSTORE_B64` secret is configured. An in-place Android update requires a signing certificate matching the installed app. If it does not match, do not uninstall before exporting/confirming a backup because uninstalling erases app-private data.

## 11. Implementation roadmap

| Phase | Scope | Status |
|---|---|---|
| 0 | Preserve existing app, theme, datasets and legacy persistence | Done in this bundle; core `app.js` and CSS remain unchanged |
| 1 | Native bridge, managed storage lifetimes, balanced diagnostics, update transaction API, manual decision and APK build automation | Foundation implemented; actual Android compilation must run in GitHub Actions |
| 2 | Extract legacy modules behind stable APIs; migrate AI Coach/chat storage and renderers individually | Planned; no legacy data migration yet |
| 3 | `.lupdate` ZIP decoding, signatures, dependency/impact planner, richer validation suite, module registry client | Planned |
| 4 | Native extension contracts, signed dynamic native loader, process restart and recovery handover | Planned; native DEX/JAR loading intentionally disabled now |
| 5 | Authenticated Development Port, private first-party registry, offline synchronization, deeper observability | Planned |
| 6 | Replaceable runtime services and bootstrap upgrade protocol | Planned; requires dedicated recovery tests |

## 12. Trust and safety boundary

- First-party modules only until there is an explicit extension trust model.
- Downloaded JS executes with host WebView privileges; it is not a sandbox.
- Downloaded DEX/JAR executes with host process privileges; class loading is not a sandbox.
- Hashes detect accidental modification/corruption, not publisher identity.
- Digital signatures and pinned keys are required before automated registry installation.
- API keys, passwords and private exam/chat data do not belong in source bundles or diagnostics.
- No automatic upload of logs or data. Diagnostic export should be explicit and local by default.
- Android permissions, signing identity, package install/update and app-private storage remain governed by Android regardless of Play Store distribution.
