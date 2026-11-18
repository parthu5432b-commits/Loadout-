# `.lupdate` package contract — draft 1.0

An update is a ZIP container with this structure:

```text
update.lupdate
├── update.json
├── modules/
│   └── <module-id>.js
├── transformations/
│   └── *.json
├── migrations/
│   └── *.json
├── tests/
│   └── *.json
└── integrity/
    ├── hashes.json
    └── signatures.json
```

The package should declare a unique `updateId`, target `appId`, target version, minimum runtime API, module IDs/versions/entry points, dependencies, transformation operations, migration contracts, validation suite, and rollback metadata. Every executable file must have a SHA-256 entry. In milestone 1, the JS runtime accepts an already-decoded `{manifest, files}` package object; the ZIP decoder, registry client, and digital-signature verification are subsequent components. Do not mistake the content hash for signer authentication.

## Transformation operation rules

- JSON operations use JSON Pointer paths and are applied only to a staged managed configuration snapshot.
- `PATCH_SOURCE` requires the exact preimage hash, exact anchor, expected occurrence count, and optional postimage hash. It is limited to module/extension source folders.
- No shell command, arbitrary file path or unrestricted filesystem operation is a valid transformation.
- Operations are preconditioned and journalled; staging must not modify active code or user data.
- The update is left in `awaiting-manual-decision` until the owner calls `commit(txId)` or `rollback(txId)`.
