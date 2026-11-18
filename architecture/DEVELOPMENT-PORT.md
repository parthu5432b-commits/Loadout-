# Development Port — staged plan

## In this build

`window.Loadout.port.status()` reports runtime/native status. `stageUpdate(pkg)`, `commit(txId)` and `rollback(txId)` expose the local update transaction API. The port is callable from the WebView console or a trusted first-party development harness. The runtime does not inject a new screen, panel or navigation item.

## Next increments

1. Local authenticated transport (USB/ADB or local network) with explicit pairing.
2. Package transfer, manifest inspection and impact report.
3. Module/source inspector, runtime logs and storage namespace inspector.
4. Native debugging bridge, Gradle build/reinstall handoff and crash symbol mapping.
5. Private registry with signed release metadata and offline cache.

The port must never accept unauthenticated commands from the LAN. Do not log API keys, AI prompts or personal JEE records by default.
