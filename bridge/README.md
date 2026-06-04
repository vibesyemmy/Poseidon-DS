# Poseidon Bridge

Local Node service that brokers between the Poseidon Figma plugin and Anthropic's API, using the credentials from your existing Claude Code install.

The plugin sandbox can't read `~/.claude/`, spawn processes, or run the Claude Agent SDK. This bridge does all three, and exposes a small HTTP API the plugin calls over `localhost:9334`.

## Quick start

```bash
cd Poseidon/bridge
pnpm install
pnpm dev      # tsx watch — restarts on file change
```

Verify it's up:
```bash
curl http://127.0.0.1:9334/ping
# { "ok": true, "name": "poseidon-bridge", "version": "0.1.0" }
```

## Requirements

- Node 20+
- Claude Code installed and logged in (`claude login`) — required from Phase 1.6 onward, not for the scaffold itself.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `POSEIDON_PORT` | `9334` | HTTP port the bridge binds to |

## Endpoints (current state)

| Method | Path | Status | Purpose |
|---|---|---|---|
| GET | `/ping` | ✅ live | Liveness probe; returns `{ ok: true }` |
| GET | `/health` | 🚧 stub | Bridge + Claude Code auth gate (Phase 1.6) |
| POST | `/chat` | ⏳ pending | SSE chat stream via Agent SDK (Phase 1.7) |
| GET | `/templates` | ⏳ pending | Merged template list (Phase 7) |
| POST | `/templates` | ⏳ pending | Save a user template (Phase 7) |
| GET | `/skills` | ⏳ pending | List loaded skills (Phase 6) |

See `Poseidon/PLAN.md` for the full roadmap.

## Project layout

```
bridge/
  src/
    server.ts          # entry — Hono app, lifecycle, route mounting
    claudeCode.ts      # auth detection + Agent SDK init   (1.2-1.5)
    chat.ts            # /chat SSE handler                  (1.7)
    skills.ts          # bundled + user skill loader        (1.8-1.10)
    templates.ts       # /templates CRUD                    (Phase 7)
  package.json
  tsconfig.json
  README.md
```
