# Poseidon scan scripts

One-off maintenance scripts that bake DS-file state into `Poseidon/data/*.json`. The bridge + plugin read those JSONs at runtime — they never re-scan live.

## When to run

- **Initial Poseidon setup** — populate all three files
- **After DS publishes new components / variants** — re-run `scan-components.ts`
- **After new templates land on the `Page template` page** — re-run `scan-templates.ts`
- **After `design-system/tokens.json` regenerates** — re-run `sync-tokens.ts`
- **Nightly in CI (recommended)** — drift detection (Phase 8 ships the workflow)

All scripts are idempotent: re-running over an existing output is safe and produces the same shape.

## sync-tokens.ts — pure Node, no Figma required

```bash
pnpm scan:tokens
# or:
npx tsx Poseidon/scripts/sync-tokens.ts
```

Copies `design-system/tokens.json` → `Poseidon/data/tokens.json`.

## scan-components.ts — requires Hydrogen DS + paperclip-figma-bridge

Reads every page of the DS file, extracts every `COMPONENT` / `COMPONENT_SET` (skipping front-matter pages and `Page template`), and writes a 98-entry catalog to `Poseidon/data/components.json`.

**To run:**

1. Open the Hydrogen DS file (`XySDEos09rLrBZTxVWZHXS`) in Figma Desktop.
2. Run `Plugins → Development → Paperclip` inside it.
3. From any Claude Code session, invoke `mcp__paperclip-figma-bridge__figma_execute` with the body of `SCAN_COMPONENTS_PAYLOAD` exported by `scan-components.ts`.
4. Pipe the returned JSON into `Poseidon/data/components.json`.

`scripts/scan-components.ts` documents the payload + output schema. There is no auto-pipe loop yet because paperclip exposes no public HTTP execute endpoint (only the MCP / WebSocket protocol). Once the Poseidon bridge proxies paperclip via MCP (Phase 8 candidate), this becomes a `pnpm scan:components` one-liner.

## scan-templates.ts — same flow

Walks the `Page template` page (node `13532:339653`) and emits 18 template entries with id, name, dimensions, category, slug to `Poseidon/data/seed-templates.json`.

Recipe extraction (the full nested node tree) is **not** part of this script — see `runtime/capture.ts` (Phase 7) which serializes selections to the schema in `runtime/schema.ts`. The two scripts share the same node walker once Phase 7 lands.

## Output files

| File | Bytes | Purpose |
|---|---|---|
| `Poseidon/data/tokens.json` | ~36 KB | W3C-format design tokens (light + dark, regular + compact modes) |
| `Poseidon/data/components.json` | ~26 KB | 98 components with `key`, `name`, `category`, `variants{}`, `defaultVariantName` |
| `Poseidon/data/seed-templates.json` | ~3 KB | 18 page-template metadata entries |
