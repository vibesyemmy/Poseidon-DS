# Poseidon — Hydrogen Design Copilot Figma Plugin

**Status:** Plan locked, pre-implementation.
**Owner:** Hydrogen Design team
**Target users:** Hydrogen designers building screens in Figma using the Hydrogen Design System.

---

## 1. What Poseidon is

A conversational AI copilot inside Figma that helps designers build screens using the Hydrogen Design System (`XySDEos09rLrBZTxVWZHXS`). Chat with it like Claude Code — describe the screen, discuss approach, get production-ready Figma frames composed from real DS components (correct tokens, text styles, auto-layout, light + dark, regular + compact).

Three primary jobs:
1. **Discuss** — talk through screen requirements before any pixels move.
2. **Compose** — instantiate templates, components, and full screens on canvas.
3. **Capture** — let designers save their own designs as reusable templates.

---

## 2. High-level architecture

```
┌─────────────────────────────────────────────────────────┐
│  Figma plugin (Preact iframe + sandbox)                 │
│                                                         │
│  ┌──────────────────────────┐  ┌─────────────────────┐  │
│  │  UI iframe (Preact)       │  │ Sandbox (main.ts)   │  │
│  │  - Chat surface           │  │ - Tool executor     │  │
│  │  - Message history (per   │  │ - figma.* ops       │  │
│  │    file via clientStorage)│  │ - Recipe walker     │  │
│  │  - Tool-call cards        │  │ - Selection inspect │  │
│  │  - Onboarding gates       │  │ - Template capture  │  │
│  └──────────┬───────────────┘  └─────────┬───────────┘  │
│             │ postMessage                 │              │
└─────────────┼─────────────────────────────┼──────────────┘
              │ fetch                       │
              ▼                             │
┌─────────────────────────────────────────────────────────┐
│  Poseidon Bridge (Node + Hono)        localhost:9334    │
│  - /health         (Claude Code auth gate)              │
│  - /chat (SSE)     (Agent SDK stream)                   │
│  - /templates      (CRUD on user + repo templates)      │
│  - /skills         (list, reload)                       │
│  Loads bundled skills + Claude Code auth automatically  │
└────────────────────────┬────────────────────────────────┘
                         │
                  [Anthropic API]
```

**Why a bridge:** Figma plugin sandbox can't read filesystem, can't spawn processes, can't access `~/.claude/` credentials. The bridge runs as a local Node process and uses `@anthropic-ai/claude-agent-sdk` which picks up Claude Code's existing auth automatically.

---

## 3. First-launch onboarding gate

Plugin runs two checks on launch:
1. **Bridge health** — `GET localhost:9334/health` (Claude Code auth)
2. **DS library enabled** — `figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync()` (in-plugin)

Combined gate states:

| State | UI shown | Action |
|---|---|---|
| `bridge-unreachable` | "Start Poseidon bridge" with `pnpm poseidon` command + copy-to-clipboard | Re-check button |
| `claude-code-missing` | "Install Claude Code first" with link to claude.com/code | Re-check after install |
| `claude-code-unauthed` | "Run `claude login` in terminal" with copy command | Re-check after login |
| `claude-code-no-credit` | "Top up credits or check subscription" with link to console.anthropic.com | Re-check |
| `ds-library-disabled` | "Enable Hydrogen DS library in this file" — screenshot of Assets → Libraries panel + step-by-step instructions | Re-check after enable |
| `ok` | Load chat UI | — |

Gate precedence: `bridge-unreachable` → `claude-code-missing` → `claude-code-unauthed` → `claude-code-no-credit` → `ds-library-disabled` → `ok`. Surface the first failing check; don't run later checks until earlier ones pass.

Detection methods (bridge-side):
- Check `~/.claude/` directory exists
- Check `claude` binary in PATH (`which claude`)
- Attempt minimal `messages.create` ping (5 input tokens, 1 output) — verifies auth + credit in one call
- No tier detection (Pro/Max/credits not reliably exposed by API)

Detection methods (plugin-side, DS library):
```ts
const libs = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
const hasHydrogen = libs.some(c => c.libraryName.includes("Hydrogen"));
```
Re-check on `currentpagechange` event (designer may switch files).

## 3b. Bridge session lifecycle

Bridge is tied to plugin lifecycle. When the plugin closes, the bridge exits. This avoids leaving an idle Node process running indefinitely after a design session.

**Protocol**

```
plugin opens
   ▼
plugin POST /session/start  →  bridge marks session active, starts idle timer
   ▼
plugin POST /session/heartbeat every 10s while plugin is open
   ▼
plugin closes (figma.on("close"))
   ├─ fast path: navigator.sendBeacon → POST /session/end → bridge exits within 1s
   └─ slow path: heartbeats stop → bridge idle timer hits 30s → graceful exit
```

**Tunables (env vars on bridge)**

| Var | Default | Purpose |
|---|---|---|
| `POSEIDON_HEARTBEAT_INTERVAL_MS` | `10000` | Plugin sends heartbeat this often |
| `POSEIDON_IDLE_TIMEOUT_MS` | `30000` | Bridge exits after this much silence post-`session/start` |
| `POSEIDON_MIN_LINGER_MS` | `5000` | Floor on grace period — covers transient network blips before plugin's first heartbeat |

**Session counter (multi-instance support)**

Bridge ref-counts active plugin instances. Designer running the plugin in multiple Figma files = multiple heartbeat streams = `activeSessions > 0` → bridge stays. Last session ends → idle timer kicks in.

```ts
// bridge state
let activeSessions = new Map<string, { lastBeatAt: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of activeSessions) {
    if (now - s.lastBeatAt > IDLE_TIMEOUT_MS) activeSessions.delete(id);
  }
  if (activeSessions.size === 0 && now - bootTime > MIN_LINGER_MS) {
    shutdown("idle");
  }
}, 5000);
```

**Edge cases**

| Scenario | Behavior |
|---|---|
| Mac sleeps with plugin open | Heartbeats pause → bridge exits after 30s wake → plugin shows `bridge-unreachable` gate, auto-retries |
| Designer force-quits Figma | `/session/end` doesn't fire → idle timeout catches it within 30s |
| Network blip drops 1-2 heartbeats | Still within 30s window, no impact |
| Plugin reopened within grace period | Sends new `/session/start` → bridge stays alive seamlessly |
| Plugin running in 3 Figma files at once | Each gets unique session id, ref count = 3, bridge exits when all three close |

## 3a. DS file presence: runtime vs scan time

**Runtime (designer using plugin)** — DS file **does NOT** need to be open in Figma Desktop.
- Component instantiation via `figma.importComponentByKeyAsync(key)` resolves through Figma's team-library backend (HTTP), independent of which files are open locally.
- Text styles (`S:...`), variables (`VariableID:...`), components — all cross-file via the published library.
- Only requirement: DS library is **enabled in Assets** for the current file. The `ds-library-disabled` gate above handles this.
- Verified empirically in prior session: instantiated EmptyStates + Button into Settlement Portal v2.0 while only that file was focused.

**Scan time (rare maintenance)** — DS file **must** be open with paperclip-figma-bridge focused on it.
- `scan-components.ts` walks the DS file tree to dump component keys + variants.
- `scan-templates.ts` walks the `Page template` page to dump 18 recipes.
- These scripts run only when DS publishes new components / templates, or in CI nightly to detect drift. Designers never run them in normal usage.

---

## 4. Chat UI

**Layout** (Figma plugin sidebar, ~360px wide):

```
┌────────────────────────────────────┐
│ Poseidon         ⚙  ✕              │  header
├────────────────────────────────────┤
│                                    │
│ ┌──────────────────────────────┐   │
│ │ User: "Build a transactions  │   │
│ │ list page with filters"      │   │
│ └──────────────────────────────┘   │
│                                    │
│ ┌──────────────────────────────┐   │
│ │ Assistant streaming...        │   │
│ │ ▸ list_templates()           │   │  collapsible
│ │ ▸ insert_template(           │   │  tool-call card
│ │     "list-page-with-filters")│   │
│ │                              │   │
│ │ Done. Dropped a filtered     │   │
│ │ list page at (0, 0). Used    │   │
│ │ Table item, Filter chip, …   │   │
│ └──────────────────────────────┘   │
│                                    │
├────────────────────────────────────┤
│ [+ Template] [+ Component]         │  shortcut chips
│ ┌──────────────────────────────┐   │
│ │ Ask Poseidon...           ↑  │   │  composer
│ └──────────────────────────────┘   │
│ /clear  /skills  /template save    │  slash hints
└────────────────────────────────────┘
```

**Features**
- SSE streaming from `/chat`
- Per-file persistence via `figma.clientStorage.setAsync(fileKey, history)`
- Tool-call cards: collapsed by default, click to expand JSON + result
- Stop button mid-stream
- Edit/Retry on user messages
- Shortcut chips inject pre-baked prompts (`+ Template` → opens template picker → produces "Insert the {name} template" prompt)
- Slash commands: `/clear`, `/skills`, `/template save`, `/template list`, `/help`, `/undo`

---

## 5. Skills (pre-bundled + extensible)

Pre-installed under `Poseidon/skills/`:

| Skill | Purpose |
|---|---|
| `hydrogen-ds` | Tokens, components, patterns, anti-patterns. Built from `docs/design-system/*` |
| `ui-ux-principles` | Hierarchy, gestalt, spacing, contrast, density |
| `accessibility` | WCAG AA, color contrast, touch targets, focus, motion |
| `responsive-layouts` | Desktop/tablet/mobile breakpoints, density modes, fluid sizing |
| `copywriting` | Microcopy, button labels, error tone, voice |
| `screen-patterns` | Empty/error/loading states, wizards, forms, modals |
| `figma-mechanics` | Auto-layout rules, constraints, instance overrides, variants |

Bridge loads skills from three locations (merged, in precedence order):
1. `Poseidon/skills/` — bundled, repo-tracked, ships with plugin
2. `~/.claude/skills/` — user's existing Claude Code skills
3. `~/.poseidon/skills/` — user's Poseidon-specific skills

Each skill is a directory with `SKILL.md` (frontmatter + body) following Claude Code skill format. Agent SDK auto-invokes based on description matching user intent — same mechanic as Claude Code.

Users can drop skills in `~/.poseidon/skills/` to extend without forking. Bridge watches the dir; reload on change.

---

## 6. Tool surface (Claude → plugin)

Agent SDK registers these tools. Claude calls them; bridge forwards to plugin sandbox via SSE → plugin executes → returns result.

All tool inputs/outputs are typed in `src/runtime/tools.ts` and shared with the bridge via `src/shared/messages.ts`. Schemas below are the source of truth; the file imports must match.

### 6.1 Catalog (overview)

| Tool | Purpose | Side effects |
|---|---|---|
| `list_components` | Discover available DS components | None (read) |
| `list_templates` | Discover available templates (bundled + repo + user) | None (read) |
| `read_selection` | Inspect what designer currently has selected | None (read) |
| `get_canvas_state` | Find empty space + viewport bounds for placement | None (read) |
| `insert_template` | Drop a full template recipe onto the canvas | Creates nodes |
| `insert_component` | Drop a single component instance | Creates nodes |
| `emit_recipe` | Build an arbitrary node tree from a recipe Claude composed | Creates nodes |
| `modify_node` | Edit an existing node (variant, text, layout, fills) | Mutates nodes |
| `capture_template` | Save current selection as a reusable template | Writes file via bridge |
| `swap_theme` | Toggle page between Light and Dark mode | Mutates variable modes |
| `swap_density` | Toggle page between Regular and Compact spacing/radius | Mutates variable modes |
| `ask_user` | Pause agent loop and prompt designer for a decision | Pauses stream |

### 6.2 Full type signatures

```ts
// runtime/tools.ts — source of truth

import type { Recipe, Node, Sizing } from "./schema";

// ─── Shared primitives ──────────────────────────────────────────────────
export type NodeId = string;
export type ComponentKey = string;     // DS team-library key, e.g. "28b5e9..."
export type TemplateSlug = string;     // e.g. "list-page-empty-state"
export type Position = { x: number; y: number };

export type ToolError = {
  ok: false;
  code:
    | "NOT_FOUND"
    | "INVALID_INPUT"
    | "LIBRARY_DISABLED"
    | "FONT_LOAD_FAILED"
    | "FIGMA_API"
    | "BRIDGE_UNREACHABLE"
    | "VALIDATION_FAILED";
  message: string;
  details?: Record<string, unknown>;
};

export type ToolOk<T> = { ok: true; value: T };
export type ToolResult<T> = ToolOk<T> | ToolError;

// ─── Component + template metadata ──────────────────────────────────────
export interface ComponentMeta {
  key: ComponentKey;
  name: string;                        // "Button", "Empty State / 01"
  category: string;                    // "Buttons", "Empty State", ...
  variants: Record<string, string[]>;  // { "Type": ["Primary","Secondary"], "Size": ["Small","Medium","Large"] }
  defaultVariant?: Record<string, string>;
  description?: string;
  thumbUrl?: string;                   // PNG data URL, baked at scan time
}

export interface TemplateMeta {
  slug: TemplateSlug;
  name: string;
  category: "Dashboard" | "List" | "Detail" | "Form" | "Onboarding" | "Error" | "Other";
  description: string;
  origin: "bundled" | "repo" | "user";
  tags: string[];
  thumbUrl?: string;
}

export interface TemplateRecord extends TemplateMeta {
  recipe: Recipe;
}

// ─── 1. list_components ─────────────────────────────────────────────────
export interface ListComponentsInput {
  category?: string;       // filter by category
  search?: string;         // case-insensitive substring match on name
  limit?: number;          // default 50, max 200
}
export type ListComponentsOutput = ToolResult<{ components: ComponentMeta[] }>;

// ─── 2. list_templates ──────────────────────────────────────────────────
export interface ListTemplatesInput {
  category?: TemplateMeta["category"];
  search?: string;
  origin?: TemplateMeta["origin"] | TemplateMeta["origin"][];
}
export type ListTemplatesOutput = ToolResult<{ templates: TemplateMeta[] }>;

// ─── 3. read_selection ──────────────────────────────────────────────────
export interface ReadSelectionInput {
  includeChildren?: boolean;   // default true; if false, only top-level summary
  maxDepth?: number;           // default 6
}
export interface SelectionSnapshot {
  count: number;
  nodes: Array<{
    id: NodeId;
    name: string;
    type: string;                // "FRAME", "INSTANCE", "TEXT", ...
    recipe?: Node;               // populated when includeChildren=true
    boundingBox: { x: number; y: number; width: number; height: number };
  }>;
}
export type ReadSelectionOutput = ToolResult<SelectionSnapshot>;

// ─── 4. get_canvas_state ────────────────────────────────────────────────
export interface GetCanvasStateInput { /* none */ }
export interface CanvasState {
  pageName: string;
  pageId: NodeId;
  viewport: { x: number; y: number; width: number; height: number; zoom: number };
  emptySpaces: Position[];       // suggested drop positions near content but not overlapping
  themeMode: "light" | "dark";
  densityMode: "regular" | "compact";
  hasHydrogenLibrary: boolean;
}
export type GetCanvasStateOutput = ToolResult<CanvasState>;

// ─── 5. insert_template ─────────────────────────────────────────────────
export interface InsertTemplateInput {
  slug: TemplateSlug;
  position?: Position;          // default: first emptySpaces entry
  parentId?: NodeId;            // optional: insert inside a frame
  overrides?: {
    text?: Record<string, string>;            // node.name → new chars
    variants?: Record<string, Record<string, string>>;  // node.name → variant props
  };
}
export interface InsertTemplateOutput {
  rootId: NodeId;
  insertedCount: number;
  warnings: string[];           // non-fatal issues (missing component, fallback fired)
}
export type InsertTemplateResult = ToolResult<InsertTemplateOutput>;

// ─── 6. insert_component ────────────────────────────────────────────────
export interface InsertComponentInput {
  key: ComponentKey;
  variant?: Record<string, string>;
  position?: Position;
  parentId?: NodeId;
  textOverrides?: Record<string, string>;
}
export interface InsertComponentOutput {
  instanceId: NodeId;
  resolvedVariant: Record<string, string>;
}
export type InsertComponentResult = ToolResult<InsertComponentOutput>;

// ─── 7. emit_recipe ─────────────────────────────────────────────────────
export interface EmitRecipeInput {
  recipe: Recipe;
  position?: Position;
  parentId?: NodeId;
}
export interface EmitRecipeOutput {
  rootId: NodeId;
  insertedCount: number;
  warnings: string[];
}
export type EmitRecipeResult = ToolResult<EmitRecipeOutput>;

// ─── 8. modify_node ─────────────────────────────────────────────────────
export type NodeChange =
  | { kind: "text"; chars: string }
  | { kind: "variant"; props: Record<string, string> }
  | { kind: "fill"; tokenRef: string }                   // "color/primary/default"
  | { kind: "stroke"; tokenRef: string; weight?: number }
  | { kind: "padding"; top?: number; right?: number; bottom?: number; left?: number }
  | { kind: "gap"; value: number }
  | { kind: "sizing"; w?: Sizing["w"]; h?: Sizing["h"] }
  | { kind: "rename"; name: string }
  | { kind: "visibility"; visible: boolean }
  | { kind: "remove" };

export interface ModifyNodeInput {
  id: NodeId;
  changes: NodeChange[];        // applied in order, atomic per node
}
export interface ModifyNodeOutput {
  id: NodeId;
  appliedCount: number;
  skipped: Array<{ index: number; reason: string }>;
}
export type ModifyNodeResult = ToolResult<ModifyNodeOutput>;

// ─── 9. capture_template ────────────────────────────────────────────────
export interface CaptureTemplateInput {
  rootId: NodeId;                             // node to capture (must be on current page)
  name: string;
  category: TemplateMeta["category"];
  description: string;
  tags?: string[];
  destination?: "user" | "repo";              // user=~/.poseidon, repo=Poseidon/templates
}
export interface CaptureValidation {
  conformingNodes: number;
  rawFallbacks: Array<{ nodeId: NodeId; reason: string }>; // non-DS nodes preserved as raw
  missingComponentKeys: string[];                          // instances whose key isn't in components.json
  rawHexColors: Array<{ nodeId: NodeId; hex: string }>;    // un-tokened colors
}
export interface CaptureTemplateOutput {
  slug: TemplateSlug;
  filePath: string;                           // absolute path bridge wrote to
  validation: CaptureValidation;
  warnings: string[];
}
export type CaptureTemplateResult = ToolResult<CaptureTemplateOutput>;

// ─── 10. swap_theme / 11. swap_density ──────────────────────────────────
export interface SwapThemeInput { target: "light" | "dark" }
export interface SwapDensityInput { target: "regular" | "compact" }
export interface SwapModeOutput { previous: string; current: string }
export type SwapThemeResult = ToolResult<SwapModeOutput>;
export type SwapDensityResult = ToolResult<SwapModeOutput>;

// ─── 12. ask_user ───────────────────────────────────────────────────────
export interface AskUserInput {
  question: string;            // markdown allowed
  options?: string[];          // if provided, render as buttons; otherwise free-text
  defaultOption?: string;
}
export interface AskUserOutput {
  answer: string;
  cancelled: boolean;          // true if designer dismissed the prompt
}
export type AskUserResult = ToolResult<AskUserOutput>;
```

### 6.3 Tool execution lifecycle

```
Claude emits tool_use
   │
   ▼
Bridge receives via Agent SDK callback
   │
   ▼
Bridge sends SSE event:  { type: "tool_call", id, name, input }
   │
   ▼
Plugin UI displays tool-call card (collapsed by default)
   │
   ▼
Plugin UI forwards to sandbox via postMessage
   │
   ▼
Sandbox runs tool from runtime/tools.ts
   ├─ wraps in figma.commitUndo() if mutation
   ├─ validates input against schema
   ├─ executes figma.* calls
   └─ returns ToolResult<T>
   │
   ▼
Plugin UI POSTs result to bridge /tool-result
   │
   ▼
Bridge feeds result back into Agent SDK loop
   │
   ▼
Claude continues reasoning (may emit more tool_use, or final assistant text)
```

### 6.4 Error contract

Every tool returns `ToolResult<T>`. On error, `{ ok: false, code, message }` flows back to Claude as a tool result. Claude decides whether to retry, fall back, or surface the issue to the user.

Common error scenarios:
- `LIBRARY_DISABLED` — designer disabled the Hydrogen library mid-session. Tool returns error; UI also re-runs gate check.
- `NOT_FOUND` — `insert_template("does-not-exist")`. Claude retries with `list_templates` first.
- `FONT_LOAD_FAILED` — `text.characters = ...` failed because font wasn't loaded. Sandbox always `loadFontAsync` before set; this fires only when fontName is undefined on style.
- `VALIDATION_FAILED` — input didn't match TS shape. Bridge could catch earlier but plugin double-checks.

### 6.5 Undo grouping

```ts
// sandbox pseudocode
async function runToolCall(call: ToolCall): Promise<ToolResult<unknown>> {
  const isMutation = MUTATING_TOOLS.has(call.name);
  if (isMutation) figma.commitUndo();    // close any prior undo group

  try {
    const result = await TOOLS[call.name](call.input);
    if (isMutation) figma.commitUndo();  // close this turn's group
    return result;
  } catch (err) {
    return { ok: false, code: "FIGMA_API", message: String(err) };
  }
}
```

One Cmd+Z reverts one assistant turn even when the turn made dozens of mutations.

---

## 7. Recipe schema (shared)

```ts
type Position = { x: number; y: number };

type Sizing = {
  w: "FILL" | "HUG" | number;
  h: "FILL" | "HUG" | number;
};

type Node =
  | {
      kind: "instance";
      key: string;                       // DS component key
      variant?: Record<string, string>;  // variant props
      overrides?: Record<string, unknown>; // instance prop overrides
      name?: string;
    }
  | {
      kind: "frame";
      name?: string;
      layout: "VERTICAL" | "HORIZONTAL" | "NONE";
      padding?: number | { top: number; right: number; bottom: number; left: number };
      gap?: number;
      sizing?: Sizing;
      fill?: string;                    // token reference, e.g. "color/special/background/page-bg"
      cornerRadius?: number;            // token reference
      align?: { primary: "MIN"|"CENTER"|"MAX"|"SPACE_BETWEEN"; counter: "MIN"|"CENTER"|"MAX" };
      children: Node[];
    }
  | {
      kind: "text";
      styleId: string;                  // DS text style id
      colorToken?: string;              // e.g. "color/text/01"
      chars: string;
      align?: "LEFT" | "CENTER" | "RIGHT";
      sizing?: Sizing;
    };

type Recipe = { root: Node; meta?: { name?: string; category?: string; description?: string } };
```

Same schema used by: bundled templates, user-saved templates, AI `emit_recipe` tool calls, palette inserter (degenerate single-node recipe). One walker (`runtime/instantiate.ts`) handles all of them.

---

## 8. Designer-added templates

**Workflow A — in-plugin capture (primary)**

1. Designer arranges DS components on canvas to make their screen.
2. Selects root frame → `/template save` or clicks "Save selection as template".
3. Plugin walks tree → produces recipe JSON.
4. Validation pass:
   - Every `INSTANCE` node must resolve to a DS component key from `components.json`.
   - Every text node should reference a DS text style.
   - Every color should be bound to a DS variable, not raw hex.
   - **Lenient mode:** warnings, not errors. Designer can proceed; non-conforming nodes get a `kind: "raw"` fallback in the recipe.
5. Designer enters name, category, description, optional tags.
6. Plugin POSTs to bridge `/templates` → bridge writes `~/.poseidon/templates/<slug>.json`.
7. Template appears in template list with `origin: "user"` badge.

**Workflow B — repo-tracked templates**

- `Poseidon/templates/*.json` for team-blessed templates (committed to git).
- Loaded same way, shown with `origin: "repo"` badge.
- Strict validation: capture path refuses to save here unless 100% DS-conforming. Lenient path saves to user dir.

**Merged list precedence**
```
Bridge GET /templates returns:
  [ ...bundled (read-only), ...repo (read-only), ...user (editable) ]
```
On slug collision, repo > user > bundled.

---

## 9. Directory layout

```
Hydrogen-Designs/Poseidon/
  manifest.json                 # Figma plugin manifest
  package.json                  # workspace root
  tsconfig.json
  README.md
  PLAN.md                       # this file

  src/
    main.ts                     # plugin sandbox entry
    ui/
      index.html
      app.tsx                   # Preact root
      components/
        Chat.tsx
        Message.tsx
        ToolCallCard.tsx
        Composer.tsx
        OnboardingGate.tsx
        TemplatePicker.tsx
        ComponentPicker.tsx
      lib/
        bridgeClient.ts         # fetch + SSE wrapper
        history.ts              # clientStorage adapter
    runtime/
      instantiate.ts            # recipe → nodes
      capture.ts                # nodes → recipe
      schema.ts                 # Node + Recipe types
      tools.ts                  # tool implementations (figma.* ops)
    shared/
      messages.ts               # UI ↔ sandbox message types

  bridge/
    package.json
    src/
      server.ts                 # Hono + routes
      claudeCode.ts             # auth detection + Agent SDK init
      chat.ts                   # /chat SSE handler
      templates.ts              # /templates CRUD
      skills.ts                 # /skills list + watcher

  skills/                       # bundled skills (pre-installed)
    hydrogen-ds/SKILL.md
    ui-ux-principles/SKILL.md
    accessibility/SKILL.md
    responsive-layouts/SKILL.md
    copywriting/SKILL.md
    screen-patterns/SKILL.md
    figma-mechanics/SKILL.md

  templates/                    # repo-tracked templates
    list-page-empty-state.json
    dashboard-with-kpis.json
    ...                         # populated by scan-templates.ts initially

  data/                         # baked at scan time
    components.json
    tokens.json                 # copy of design-system/tokens.json
    seed-templates.json         # seed from DS file

  scripts/
    scan-components.ts          # one-time: dump DS component keys + variants
    scan-templates.ts           # one-time: dump 18 page templates as recipes
    sync-tokens.ts              # copy tokens from design-system/tokens.json
    dev.ts                      # esbuild watch + bridge start

  build/                        # esbuild output (gitignored)
```

---

## 10. Build phases (trackable)

Approach: **full minimal end-to-end first, then thicken each piece**. By end of phase 4, designer can chat with Poseidon, ask "insert empty-state list page", and see it appear. Subsequent phases add depth.

Check items off as they ship. Update commit SHA or PR link next to each when merged.

### Phase 1 — Bridge MVP (1 day) — `[x]` complete

- [x] 1.1 `bridge/` scaffold (Node 20 + Hono + tsx + tsconfig + package.json)
- [x] 1.2 `claudeCode.ts` — detect `~/.claude/` exists
- [x] 1.3 `claudeCode.ts` — detect `claude` binary in PATH
- [x] 1.4 `agentSdk.ts` — Agent SDK lazy import + default `query()` options (SDK reads Claude Code creds via local `claude` binary)
- [x] 1.5 `agentSdk.ts` — `pingClaudeCode()` minimal round-trip → ok / unauthed / no-credit / unreachable
- [x] 1.6 `/health` endpoint returning one of 5 states (`health.ts` composer + `?skipPing=1` fast-path)
- [x] 1.7 `/chat` SSE endpoint streaming Agent SDK events (`chat.ts` via `streamSSE`)
- [x] 1.8 Skill loader walks `Poseidon/skills/` + parses SKILL.md frontmatter
- [x] 1.9 Skill loader composes skills into systemPrompt append (Phase 6 swaps to SDK plugin loading)
- [x] 1.10 One stub skill `hydrogen-ds/SKILL.md` (1082 chars) loaded; verified Claude uses it (`color/text/01` answer)
- [x] 1.11 `pnpm poseidon` dev script (watches + restarts via tsx)
- [x] 1.12 Manual smoke test: `/ping`, `/health`, `/skills`, `/session/*`, `/chat` SSE — all pass
- [x] 1.13 Session lifecycle endpoints: `POST /session/start`, `POST /session/heartbeat`, `POST /session/end`
- [x] 1.14 Idle-timeout reaper (verified: bridge self-exits after 2s with short timeouts)
- [x] 1.15 Env-var tunables: `POSEIDON_HEARTBEAT_INTERVAL_MS`, `POSEIDON_IDLE_TIMEOUT_MS`, `POSEIDON_MIN_LINGER_MS`, `POSEIDON_REAPER_INTERVAL_MS`, `POSEIDON_INCLUDE_CLAUDE_SKILLS`

### Phase 2 — Plugin scaffold + onboarding (1 day) — `[x]` complete

- [x] 2.1 `manifest.json` with editorType, dynamic-page documentAccess, network access for localhost:9334
- [x] 2.2 esbuild config (manual two-target build in `scripts/build.mjs` — sandbox + UI iframe)
- [x] 2.3 Preact app shell (`app.tsx`) renders inside Figma plugin window
- [x] 2.4 `bridgeClient.ts` fetch wrapper + SSE-ready (SSE consumer lands in Phase 4)
- [x] 2.5 `OnboardingGate.tsx` polls `/health` every 3s when not `ok`
- [x] 2.6 DS-library check via `getAvailableLibraryVariableCollectionsAsync` (sandbox-side)
- [x] 2.7 Gate state precedence resolver (`gateState.ts` — 7 transitions verified)
- [x] 2.8 Render `bridge-unreachable` screen (with copy command)
- [x] 2.9 Render `claude-code-missing` screen (with link)
- [x] 2.10 Render `claude-code-unauthed` screen (with copy command)
- [x] 2.11 Render `claude-code-no-credit` screen (with link)
- [x] 2.12 Render `ds-library-disabled` screen (with instructions; screenshot in Phase 8)
- [x] 2.13 Re-check trigger on `figma.on('currentpagechange')` (sandbox emits `sandbox:page-changed`)
- [x] 2.14 Chat surface placeholder (input disabled, empty-state copy, brand header)
- [x] 2.15 Session start: `SessionClient.start()` on screen→ok transition
- [x] 2.16 Heartbeat ticker: POST `/session/heartbeat` every 10s while plugin open
- [x] 2.17 Session end: `pagehide`/`beforeunload` → `navigator.sendBeacon` POST `/session/end`
- [x] 2.18 Reconnect on wake: heartbeat 404 → re-issue `/session/start` to re-attach

### Phase 3 — Scans (1 day) — `[x]` complete

- [x] 3.1 `sync-tokens.ts` copies `design-system/tokens.json` → `data/tokens.json` (36 KB)
- [x] 3.2 `scan-components.ts` walks DS file, dumps 98 components → `data/components.json` (26 KB)
- [x] 3.3 `scan-components.ts` captures variant property schema per component (via `componentPropertyDefinitions`)
- [x] 3.4 `scan-components.ts` captures category from page name (42 categories)
- [x] 3.5 `scan-templates.ts` walks `Page template` page (`13532:339653`) — 18 templates
- [x] 3.6 `scan-templates.ts` emits per-template metadata → `data/seed-templates.json` (3 KB). Full recipe extraction lives in `runtime/capture.ts` (Phase 7) and is shared with `insert_template` walk-in-reverse.
- [x] 3.7 All three scripts idempotent + safe to re-run (try/catch around broken sets, slug stable)
- [x] 3.8 `scripts/README.md` documenting when + how to run scans + workspace `package.json` shortcuts

### Phase 4 — End-to-end chat + one tool (2 days) — `[x]` complete

- [x] 4.1 `runtime/schema.ts` — `FrameNode`, `InstanceNode`, `TextNode`, `StubNode` + `Recipe`
- [x] 4.2 `runtime/instantiate.ts` — handles `kind: "frame"` (layout, padding, gap, sizing, fill, align)
- [x] 4.3 `runtime/instantiate.ts` — handles `kind: "instance"` (importComponentByKeyAsync + variant + overrides + fallback stub)
- [x] 4.4 `runtime/instantiate.ts` — handles `kind: "text"` (font load + textStyleId + colorToken hex)
- [x] 4.5 `runtime/tools.ts` — `insert_template(slug, name, w, h, position?)` ships a labelled stub frame (full recipe in Phase 5)
- [x] 4.6 Bridge `tools.ts` — `list_templates(category?, search?)` reads `data/seed-templates.json` (bridge-only, no sandbox roundtrip)
- [x] 4.7 Sandbox `runtime/tools.ts` — `read_selection()`, `get_canvas_state()`
- [x] 4.8 Bridge registers 5 SDK MCP tools via `createSdkMcpServer` + zod schemas (list_templates, list_components, insert_template, read_selection, get_canvas_state) — SDK 0.3.144
- [x] 4.9 SSE events: `meta`, `message`, `tool_request`, `done`, `error`; `/tool-response` POST route closes the roundtrip
- [x] 4.10 Plugin UI renders streaming assistant text (Preact `Chat.tsx`)
- [x] 4.11 Plugin UI renders collapsible tool-call cards with running/done/error pills
- [x] 4.12 Sandbox receives `ui:run-tool` from UI, dispatches to `SANDBOX_TOOLS`, returns via `sandbox:tool-result`
- [x] 4.13 **Acceptance**: "Insert the empty-state list page" → stub frame `List page · Empty state` (1440×982) appears on canvas, tool sequence visible in chat
- [x] 4.14 dedupe tool-call cards by `tool_use_id` (`upsertToolCard` + `onToolRequest` no longer creates duplicate card)
- [x] 4.15 resolve bridge-only tool cards on Claude's `tool_result` user message (cards flip to `done` regardless of whether tool ran in bridge or sandbox)

### Phase 5 — Full tool surface (2 days) — `[x]` complete (5.8 capture stub deferred to Phase 7)

- [x] 5.1 `insert_component(key, variant, textOverrides, position)` — bridge resolves SET key → defaultVariantKey; sandbox imports default + applies variant via `setProperties` + walks TEXT children for `textOverrides`
- [x] 5.2 `emit_recipe(root, position, parentId)` — Claude composes Recipe tree, walker instantiates via `runtime/instantiate.ts`
- [x] 5.3 `modify_node(id, changes)` — 9 change kinds: text, variant, fill, padding, gap, sizing, rename, visibility, remove
- [x] 5.4 `swap_theme(target)` — flips Light/Dark via `setExplicitVariableModeForCollection`
- [x] 5.5 `swap_density(target)` — same pattern for Regular/Compact
- [x] 5.6 `get_canvas_state()` — page id/name, viewport, empty-space candidates (delivered in Phase 4)
- [x] 5.6a `figma_execute(code)` — paperclip-style escape hatch; arbitrary JS with `figma` global
- [x] 5.6b `get_styles({ scope, kind, search })` — DS-scoped via `data/styles.json` (52 text + 4 paint + 12 effect), `scope: 'local'` falls back to sandbox
- [x] 5.6c `get_variables({ collectionName })` — sandbox lists local variable collections + per-mode values
- [x] 5.6d `capture_screenshot({ nodeId, scale, format })` — exports node as base64 PNG/JPG/SVG; UI renders inline `<img>`
- [x] 5.7 `ask_user(question, options?)` — interactive prompt rendered as `AskUserBlock`, paused agent loop (Claude awaits via toolRouter promise), options as buttons or free-text input with default + cancel
- [ ] 5.8 `capture_template()` stub (full impl in phase 7)
- [x] 5.9 Component palette shortcut chip → `ComponentPicker` overlay → injected prompt
- [x] 5.10 Template picker shortcut chip → `TemplatePicker` overlay → injected prompt
- [x] 5.11 Variant pickers inline in component picker (per-prop dropdowns + label-text input, pre-selected from `defaultVariantName`)
- [x] 5.12 `figma.commitUndo()` brackets each assistant turn (sandbox handles `ui:turn-start` / `ui:turn-end` — per-tool commits removed to avoid fragmenting the turn)
- [x] 5.13 Acceptance: verified live — multi-tool turn reverts in a single Cmd+Z

### Phase 6 — Skills (1 day) — `[x]` complete (6.10 is observational; SDK plugin lazy-load deferred to Phase 8)

- [x] 6.1 `hydrogen-ds/SKILL.md` — non-negotiable rules + token shorthand + tool-driven discovery workflow (6.3KB after sync)
- [x] 6.2 `ui-ux-principles/SKILL.md` — hierarchy, gestalt, spacing rhythm, density, scanability (1.7KB)
- [x] 6.3 `accessibility/SKILL.md` — WCAG AA contrast, touch targets, focus, motion-safety, status signaling (1.6KB)
- [x] 6.4 `responsive-layouts/SKILL.md` — Desktop/Tablet/Mobile breakpoints + Regular/Compact density (1.6KB)
- [x] 6.5 `copywriting/SKILL.md` — voice, buttons, errors, empty states, status/toasts (1.7KB)
- [x] 6.6 `screen-patterns/SKILL.md` — empty/error/loading, forms, wizards, modals, confirmations (2.1KB)
- [x] 6.7 `figma-mechanics/SKILL.md` — async-first, library imports, auto-layout, variables, common bugs (2.5KB)
- [x] 6.8 Skill watcher reloads on file change (`fs.watch` recursive on each skill root, 300ms debounce; verified live — chars updated from 3083→6297 without restart)
- [x] 6.9 `/skills` slash command (lists loaded skills); `/clear`, `/help` also wired
- [~] 6.10 *(observational)* Claude inherits skills via system-prompt injection — not lazy-loaded. Verified via prior `color/text/01` answer test. True lazy-load via SDK plugin manifest deferred to Phase 8.
- [x] 6.11 `scripts/sync-skills.ts` splices CLAUDE.md's "Non-Negotiable Rules" + "Token Cheat Sheet" into `hydrogen-ds/SKILL.md` between markers — idempotent, safe to re-run

### Phase 7 — Template authoring (1 day) — `[x]` code complete (7.10 pending live test)

- [x] 7.1 `runtime/capture.ts` walks selection → Recipe; lenient stub fallback for raw shapes
- [x] 7.2 INSTANCE → `kind: "instance"` with set key (resolved through `mainComponent.parent`), variant parsed from variant-node name, `textOverrides` diffed against source defaults
- [x] 7.3 FRAME/COMPONENT/GROUP → `kind: "frame"` with layout (HORIZONTAL/VERTICAL/NONE), padding (per-edge or symmetric), gap, sizing (FILL/HUG/number), fill (token via `boundVariables.fills` → `var(name)`, else hex), corner radius, primary/counter alignment
- [x] 7.4 TEXT → `kind: "text"` with `textStyleId`, chars, align, color (token reference if bound, else hex)
- [x] 7.5 Lenient: `warnings[]` per non-faithful node, `stubFor` placeholder, never refuses to walk
- [x] 7.6 `/template save` slash command in Chat — dispatches a structured prompt that uses `ask_user` to collect name + category, then calls `capture_template`
- [x] 7.7 Bridge `capture_template` tool persists `recipe` + meta to `~/.poseidon/templates/<slug>.json`; `templates.ts` module owns CRUD
- [x] 7.8 Bridge `GET /templates` + tool `list_templates` return merged bundled + repo + user with `origin` + `hasRecipe` flags; user > bundled on slug collision
- [x] 7.9 Saved templates surface in `list_templates`; `insert_template` walks the recipe directly when `hasRecipe`, falls back to stub frame otherwise
- [ ] 7.10 Acceptance: capture a screen, list_templates shows it, insert_template re-instantiates → visual diff matches (pending live test)

### Phase 8 — Polish + docs (2 days) — `[ ]` overall

- [ ] 8.1 Per-file chat history via `figma.clientStorage.setAsync(fileKey, history)`
- [ ] 8.2 History trims to last N turns (configurable, default 50)
- [ ] 8.3 Edit-message on user turns (re-runs from that point)
- [ ] 8.4 Retry button on assistant turns
- [ ] 8.5 Stop button cancels mid-stream
- [ ] 8.6 Slash command palette (`/clear`, `/skills`, `/template save`, `/help`, `/undo`)
- [ ] 8.7 Error state: stream interruption (auto-reconnect SSE)
- [ ] 8.8 Error state: bridge crash mid-turn (clear UX, restart instructions)
- [ ] 8.9 Error state: Claude API errors (rate limit, credit, server)
- [ ] 8.10 Empty-state "What can I ask?" with 3-5 example prompts
- [ ] 8.11 Hover help on tool-call cards
- [ ] 8.12 README with install + dev + build + scan + publish steps
- [ ] 8.13 CHANGELOG.md seeded with v0.1.0 entry

**Total: ~11 days for a polished v1. ~85 trackable items.**

### Tracker rules

- Tick item only when the acceptance criterion is met, not when partially done.
- When all items in a phase tick, mark the phase header `[x]` and commit `feat(poseidon): complete phase N — <summary>`.
- Use this file as the single source of truth for project status. Don't track in external tools.

---

## 11. Prompt caching strategy

The system prompt is large (DS spec + tools + skills). Use Anthropic prompt caching:

```
[cached: system prompt]
  Hydrogen Design System spec (components, tokens, patterns)
  Tool definitions
  Loaded skills relevant to current context

[cached: conversation history up to last user turn]

[uncached: latest user message + tool results]
```

Cache hit on every follow-up turn. First turn ~$0.05; subsequent turns ~$0.005. 10x cost reduction.

Cache breakpoints set by Agent SDK automatically when system prompt + history exceed minimum cacheable tokens (1024 for Sonnet 4.5).

---

## 12. Open risks + mitigations

| Risk | Mitigation |
|---|---|
| Agent SDK skill loading API undocumented for custom paths | Verify before phase 1; fall back to manual prompt injection if SDK doesn't support custom skill dirs |
| Claude Code OAuth refresh during long sessions | Bridge re-reads creds before each Anthropic call |
| Plugin sandbox 4MB heap limit for large recipes | Stream recipe walk in chunks; show progress bar in tool-call card |
| Component key drift when DS publishes new versions | `scan-components.ts` runs in CI nightly; warn on missing keys at insert time |
| DS library disabled in target file | Onboarding gate detects via `getAvailableLibraryVariableCollectionsAsync`; instructs designer to enable in Assets panel before chat unlocks |
| Designer captures non-DS nodes | Lenient mode with explicit warning + raw fallback in recipe |
| Network failures mid-stream | SSE auto-reconnect; on bridge crash, plugin shows "Bridge disconnected, restart with `pnpm poseidon`" |
| Concurrent edits while Claude inserts | Wrap inserts in `figma.commitUndo()`; check selection unchanged between tool calls |

---

## 13. Future (post-v1)

- Team-shared template sync via git remote
- Multi-file refactors ("apply this token swap across 5 screens")
- Component diff: "what changed in DS since last week?"
- Live design review: paste a screenshot, get a11y + design critique
- Variant matrix generator for new components
- Plugin published to Figma org (currently dev-only)

---

## 14. Glossary

- **Bridge**: local Node process at `localhost:9334`, handles Claude auth + Anthropic calls.
- **Sandbox**: Figma's plugin execution environment, only place `figma.*` works.
- **UI iframe**: HTML page rendered inside Figma's plugin window, runs Preact.
- **Recipe**: declarative JSON description of a node tree, instantiated by the walker.
- **Skill**: markdown doc with frontmatter that Claude auto-loads when relevant; same format as Claude Code skills.
- **Component key**: global identifier for a DS component, stable across files when library is published.
