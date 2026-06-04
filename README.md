# Poseidon

Conversational AI copilot inside Figma for the **Hydrogen Design System**. Chat in the plugin sidebar, describe a screen, get production-ready Figma frames composed from real DS components — correct tokens, text styles, auto-layout, Light + Dark, Regular + Compact.

> **Status:** active build. Phases 1–7 complete. See [`PLAN.md`](./PLAN.md) for the full plan + architecture.

---

## What you can do with it

- **Discuss** — talk through requirements before any pixels move.
- **Compose** — instantiate templates and components, drop full screens on canvas using the right tokens automatically.
- **Capture** — save your own designs as reusable templates.

The plugin uses the templates and atoms from the published Hydrogen DS library (`XySDEos09rLrBZTxVWZHXS`) — every screen is on-brand by default.

---

## Quick start (designers)

You only do this once. ~10 minutes.

### Prerequisites

- **Figma Desktop** (the plugin runs in dev mode — Web Figma can't load it).
- **Node 20+** — check with `node -v`.
- **pnpm** — install with `npm i -g pnpm` if missing.
- **Claude Code** — installed and logged in on this machine. The bridge reuses your Claude credentials so you don't need to manage API keys.
  - Install: https://docs.anthropic.com/claude-code
  - Then run `claude login` once.
- The Hydrogen DS file must be **added to your Figma file's libraries** (Assets panel → Libraries → enable `Hydrogen Design System 2023 (Desktop)`).

### 1. Clone

```bash
git clone https://github.com/vibesyemmy/Poseidon-DS.git
cd Poseidon-DS
```

### 2. Install

```bash
pnpm install
```

This installs both `bridge/` and `plugin/` workspaces.

### 3. Build the plugin once

```bash
pnpm --filter @poseidon/plugin build
```

Produces `plugin/dist/` — the bundle Figma loads.

### 4. Import the plugin into Figma Desktop

1. Open any file in **Figma Desktop**.
2. Menu → **Plugins → Development → Import plugin from manifest…**
3. Pick `Poseidon-DS/plugin/manifest.json`.
4. Poseidon now lives in **Plugins → Development → Poseidon**.

You only do this step once per machine.

### 5. Start the bridge (every session you want to use Poseidon)

In a terminal:

```bash
pnpm bridge:dev
```

You should see:

```
poseidon-bridge listening on http://127.0.0.1:9334
```

Leave this terminal open while you design. Close it when you're done.

Quick health check (optional, in a second terminal):

```bash
curl http://127.0.0.1:9334/ping
# { "ok": true, "name": "poseidon-bridge", "version": "0.1.0" }
```

### 6. Open Poseidon in Figma

1. In Figma Desktop, open the file you want to design in (must have the Hydrogen DS library enabled).
2. **Plugins → Development → Poseidon**.
3. First run shows an onboarding gate that checks Node / bridge / Claude login / DS subscription. Fix anything red, click retry.
4. Once green, chat away: _"Build a transactions list screen showing vendors from Ghana"_.

---

## Daily flow (after first-time setup)

1. Open Figma Desktop on your design file.
2. In a terminal: `pnpm bridge:dev`.
3. Figma → **Plugins → Development → Poseidon** → chat.

That's it.

---

## Working with templates

Poseidon's first move on any "build a screen" request is to check Hydrogen DS templates. There are **5 published variant sets**:

- **List page** (With KPIs and table · With tabs and table · Empty state)
- **Detail page** (Simple · With tabs · Pending · Rejected · With confirmation modal)
- **Form** (Simple · Multi-section · Grouped · Bulk upload · Wizard)
- **Onboarding** (Login · Login with error toast · OTP)
- **Settings** (Default · OTP-protected)

If your intent matches one, Poseidon instantiates it and overrides content for you. If nothing matches, it **stops and asks** before composing from atoms — you stay in control.

Full catalog with `Use when` / `Don't use when` per variant: see the `docs/design-system/03-templates.md` reference in the parent Hydrogen-Designs workspace.

---

## What if something doesn't work

| Symptom | Likely cause | Fix |
|---|---|---|
| Plugin shows red bridge status | Bridge not running | Re-run `pnpm bridge:dev` |
| Plugin shows red Claude status | Not logged in to Claude Code | `claude login` in terminal |
| "Hydrogen DS not subscribed" | Library not enabled on this file | Assets panel → Libraries → enable `Hydrogen Design System 2023 (Desktop)` |
| Plugin doesn't appear in menu | Manifest not imported | Re-do step 4 |
| Chat sends but nothing happens on canvas | Plugin sandbox crashed | Close plugin window → reopen |

For deeper issues: `pnpm bridge:dev` terminal usually surfaces the real error. Share that output in #design-systems.

---

## Updating

```bash
git pull
pnpm install        # picks up new bridge/plugin deps
pnpm --filter @poseidon/plugin build
```

Then re-open Poseidon in Figma — it auto-loads the new bundle.

---

## Repository layout

```
Poseidon-DS/
  PLAN.md           # full plan + architecture (read for "why")
  README.md         # you are here (read for "how")
  bridge/           # local Node service ↔ Claude API
  plugin/           # Figma plugin (sandbox + UI)
  skills/           # AI skills the copilot loads (hydrogen-ds, screen-patterns, …)
  scripts/          # token / skill / component sync scripts
  data/             # cached DS scans (tokens, components, templates)
```

For developers extending Poseidon, the deep-dive is in [`PLAN.md`](./PLAN.md) sections 2 (architecture), 6 (tool surface), 9 (directory layout), 10 (build phases).

---

## Help

- Plan + architecture: [`PLAN.md`](./PLAN.md)
- Bridge details: [`bridge/README.md`](./bridge/README.md)
- Plugin details: [`plugin/README.md`](./plugin/README.md)
- Design-system templates / tokens reference: in the parent Hydrogen-Designs workspace, `docs/design-system/`.
- Stuck? Post in **#design-systems** with the bridge terminal output.
