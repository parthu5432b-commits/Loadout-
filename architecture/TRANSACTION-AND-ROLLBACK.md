# Update transaction and rollback rules

1. **Inspect** — read the manifest, target app/runtime, current module registry and required capabilities.
2. **Plan** — resolve dependencies, operation order, affected namespaces and required restart/build level.
3. **Snapshot** — retain the previous module registry and managed configuration. Existing user state must have an explicit migration/backup plan before it is touched.
4. **Stage** — copy candidate files into inactive storage; compute hashes; run transformation preconditions.
5. **Transform** — apply declarative and controlled source patches only to candidate state.
6. **Validate** — package shape, dependency compatibility, module hashes, migration invariants and critical smoke tests.
7. **Manual decision** — wait for explicit commit or rollback. Do not activate merely because validation passed.
8. **Activate** — load candidate module code, switch the registry/configuration and record the decision.
9. **Recover** — activation failure restores previous registry/configuration. Post-commit rollback preserves module-owned data and requires a compatible migration or forward recovery if its schema changed.

A code rollback is not automatically a data rollback. A destructive or non-reversible migration must be disclosed in the plan and backed by a snapshot or a forward-recovery path.
