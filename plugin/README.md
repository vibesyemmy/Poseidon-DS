# Poseidon Plugin

The Figma plugin half of Poseidon. Renders a chat UI in Figma's sidebar, talks to the Poseidon bridge over `localhost:9334`, and executes canvas mutations via `figma.*` in response to bridge-streamed tool calls.

## Layout

```
plugin/
  manifest.json              # Figma plugin manifest
  scripts/build.mjs          # esbuild orchestrator (two targets: sandbox + ui)
  src/
    sandbox/main.ts          # Plugin sandbox entry (figma.* API only)
    ui/
      index.tsx              # iframe entry, mounts Preact root
      app.tsx                # gate state machine + screen routing
      components/
        OnboardingGate.tsx   # 6 gate screens + loading
        Chat.tsx             # chat surface placeholder (wired in Phase 4)
      lib/
        bridgeClient.ts      # fetch wrapper for localhost:9334
        sandboxBridge.ts     # postMessage helpers UI↔sandbox
        sessionClient.ts     # heartbeat ticker + sendBeacon cleanup
        gateState.ts         # resolveGate(input) → GateScreen
    shared/messages.ts       # UI ↔ sandbox message types
```

## Quick start

```bash
cd Poseidon/plugin
pnpm install
pnpm dev            # esbuild watch, rebuilds dist/ on change
```

Then in Figma Desktop: `Plugins → Development → Import plugin from manifest…` and pick `Poseidon/plugin/manifest.json`.

For Poseidon to do anything, the bridge must also be running:

```bash
cd Poseidon/bridge
pnpm dev
```

## How it boots

1. Plugin opens → sandbox shows UI iframe → UI sends `ui:ready`
2. Sandbox replies with `sandbox:canvas-state` + `sandbox:ds-library-status`
3. UI fetches `/health` from bridge
4. `resolveGate()` combines both signals → screen state
5. If `state === "ok"`, chat surface mounts and a Poseidon session opens
6. UI heartbeats `/session/heartbeat` every 10 s
7. Window unload → `navigator.sendBeacon('/session/end')` so the bridge exits

If anything fails, `OnboardingGate` shows the matching screen with a copy-the-fix-command button + Re-check.
