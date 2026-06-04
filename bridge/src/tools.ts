/**
 * SDK MCP tool definitions.
 *
 * Tools either:
 *   - Run *here* in Node (bridge-only) — e.g. anything that just reads
 *     baked JSON from `data/`. No round-trip needed.
 *   - Run *there* in the plugin sandbox — e.g. anything calling `figma.*`.
 *     Dispatched via `ToolRouter` over the chat SSE.
 *
 * Phase 4 tools:
 *   list_templates   bridge
 *   list_components  bridge
 *   read_selection   sandbox
 *   get_canvas_state sandbox
 *   insert_template  sandbox
 */

import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import type { ToolRouter, SandboxToolResult } from "./toolRouter.ts";
import { listAll as listAllTemplates, saveUser, getBySlug } from "./templates.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "..", "..", "data");

// ─── Bridge-only data loaders ───────────────────────────────────────────

interface ComponentMeta {
  key: string;
  name: string;
  category: string;
  isVariantSet: boolean;
  variants?: Record<string, string[]>;
  /** Key of the default variant inside the set. THIS is the key that
   *  `importComponentByKeyAsync` accepts — the COMPONENT_SET `key` won't
   *  resolve via Figma's library service. */
  defaultVariantKey?: string;
  defaultVariantName?: string;
}

interface StyleEntry {
  id: string;
  key: string;
  name: string;
  fontFamily?: string;
  fontStyle?: string;
  fontSize?: number;
  lineHeightPx?: number;
  letterSpacingPct?: number;
  kind?: string;
  effectCount?: number;
}
interface StylesFile {
  textStyles: StyleEntry[];
  paintStyles: StyleEntry[];
  effectStyles: StyleEntry[];
}

let componentsCache: ComponentMeta[] | null = null;
let stylesCache: StylesFile | null = null;

async function loadComponents(): Promise<ComponentMeta[]> {
  if (!componentsCache) {
    const raw = await readFile(resolve(DATA_DIR, "components.json"), "utf8");
    componentsCache = (JSON.parse(raw) as { components: ComponentMeta[] }).components;
  }
  return componentsCache;
}
async function loadStyles(): Promise<StylesFile> {
  if (!stylesCache) {
    const raw = await readFile(resolve(DATA_DIR, "styles.json"), "utf8");
    stylesCache = JSON.parse(raw) as StylesFile;
  }
  return stylesCache;
}

// ─── Tool result helpers ────────────────────────────────────────────────

function jsonContent(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

async function dispatchAndPack(
  router: ToolRouter,
  name: string,
  input: unknown,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const res: SandboxToolResult = await router.dispatch(name, input);
  if (res.ok) return jsonContent(res.value);
  return { ...jsonContent({ error: res.code, message: res.message }), isError: true };
}

// ─── Tool factories ─────────────────────────────────────────────────────

export function createPoseidonTools(router: ToolRouter) {
  return [
    tool(
      "list_templates",
      "List Hydrogen DS page templates (Dashboard, List, Detail, Form, Onboarding, …) including any user- or repo-saved templates. Each entry has an `origin` tag: bundled (read-only metadata), repo (team-blessed full recipe), or user (designer-saved).",
      {
        category: z.string().optional().describe("Filter by category (Dashboard, List, Detail, Form, Onboarding, Error, Other, or any custom user category)"),
        search: z.string().optional().describe("Case-insensitive substring match on name"),
        origin: z.enum(["bundled", "repo", "user"]).optional().describe("Filter by origin"),
      },
      async (input) => {
        const all = await listAllTemplates();
        let result = all;
        if (input.category) result = result.filter((t) => t.category === input.category);
        if (input.origin) result = result.filter((t) => t.origin === input.origin);
        if (input.search) {
          const q = input.search.toLowerCase();
          result = result.filter((t) => t.name.toLowerCase().includes(q));
        }
        return jsonContent({
          count: result.length,
          templates: result.map((t) => ({
            slug: t.slug,
            name: t.name,
            category: t.category,
            origin: t.origin,
            description: t.description ?? "",
            width: t.width,
            height: t.height,
            hasRecipe: t.recipe !== null,
          })),
        });
      },
    ),

    tool(
      "list_components",
      "List Hydrogen DS components — keys, variants, categories. Use to discover which components exist before calling insert_component or emit_recipe.",
      {
        category: z.string().optional().describe("Filter by DS page/category"),
        search: z.string().optional().describe("Case-insensitive substring match on name"),
        limit: z.number().int().min(1).max(200).optional().default(50),
      },
      async (input) => {
        const all = await loadComponents();
        let result = all;
        if (input.category) {
          const q = input.category.toLowerCase();
          result = result.filter((c) => c.category.toLowerCase().includes(q));
        }
        if (input.search) {
          const q = input.search.toLowerCase();
          result = result.filter((c) => c.name.toLowerCase().includes(q));
        }
        const limit = input.limit ?? 50;
        return jsonContent({
          count: result.length,
          truncated: result.length > limit,
          components: result.slice(0, limit),
        });
      },
    ),

    tool(
      "insert_template",
      "Drop a page template onto the current Figma canvas. Templates with a full recipe (`hasRecipe: true` in list_templates) instantiate as real component trees; templates that are metadata-only insert a labelled stub frame at the template's dimensions.",
      {
        slug: z.string().describe("Template slug from list_templates"),
        position: z
          .object({ x: z.number(), y: z.number() })
          .optional()
          .describe("Optional position; otherwise auto-placed in empty space"),
      },
      async (input) => {
        const tmpl = await getBySlug(input.slug);
        if (!tmpl) {
          return {
            ...jsonContent({ error: "NOT_FOUND", message: `no template '${input.slug}'` }),
            isError: true,
          };
        }
        if (tmpl.recipe) {
          // Real recipe — walk via emit_recipe path.
          return dispatchAndPack(router, "emit_recipe", {
            recipe: tmpl.recipe,
            position: input.position,
          });
        }
        // Fallback: stub frame matching the template dims.
        return dispatchAndPack(router, "insert_template", {
          slug: tmpl.slug,
          name: tmpl.name,
          width: tmpl.width,
          height: tmpl.height,
          position: input.position,
        });
      },
    ),

    tool(
      "insert_component",
      [
        "Drop a single DS component instance onto the canvas. Use list_components first to find the component.",
        "",
        "Pass the `key` from list_components — for variant sets we look up the matching variant or the default. Variant keys/values must match the schema returned by list_components exactly.",
      ].join("\n"),
      {
        key: z.string().describe("DS component or component-set key (from list_components)"),
        variant: z.record(z.string(), z.string()).optional().describe("Variant overrides like { Type: 'Primary', Size: 'Medium' }"),
        textOverrides: z.record(z.string(), z.string()).optional().describe(
          "Override text nodes inside the instance by layer name → new chars. " +
            "Hydrogen Button has a TEXT child named 'Label'; pass { Label: 'Save changes' }.",
        ),
        position: z.object({ x: z.number(), y: z.number() }).optional(),
        parentId: z.string().optional().describe("Optional parent node id to insert into"),
        name: z.string().optional().describe("Optional layer name"),
      },
      async (input) => {
        // Resolve set key → default variant key so the sandbox calls
        // importComponentByKeyAsync with a COMPONENT (not SET) key.
        const components = await loadComponents();
        const found = components.find((c) => c.key === input.key);
        const resolvedKey = found?.isVariantSet && found.defaultVariantKey
          ? found.defaultVariantKey
          : input.key;
        return dispatchAndPack(router, "insert_component", {
          ...input,
          key: resolvedKey,
          // Pass the original (set) key so the sandbox can log it on failure.
          setKey: input.key !== resolvedKey ? input.key : undefined,
        });
      },
    ),

    tool(
      "emit_recipe",
      [
        "Build an arbitrary node tree on the canvas from a Recipe. Use when no template or single component fits the request.",
        "",
        "Recipe schema:",
        '  Node = { kind: "frame", layout: "VERTICAL"|"HORIZONTAL"|"NONE", padding?: number|{top,right,bottom,left}, gap?: number, sizing?: { w?: "FILL"|"HUG"|number, h?: ... }, fill?: "#hex", cornerRadius?: number, align?: { primary?, counter? }, children: Node[] }',
        '       | { kind: "instance", key: string, variant?: Record<string,string>, name?: string }',
        '       | { kind: "text", chars: string, align?: "LEFT"|"CENTER"|"RIGHT", styleId?: string, colorToken?: "#hex" }',
        "",
        "Token-bound fills/colors aren't supported yet — use hex for now (Phase 6 adds token binding).",
      ].join("\n"),
      {
        recipe: z.any().describe("Recipe root node (see schema in description)"),
        position: z.object({ x: z.number(), y: z.number() }).optional(),
        parentId: z.string().optional(),
      },
      async (input) => dispatchAndPack(router, "emit_recipe", input),
    ),

    tool(
      "modify_node",
      [
        "Edit an existing node. Changes apply in order; ones that don't fit the node type are skipped (you'll see them in `skipped[]`).",
        "",
        "Available change kinds:",
        '  { kind: "text", chars: string }                                       (TEXT only)',
        '  { kind: "variant", props: { ... } }                                   (INSTANCE only)',
        '  { kind: "fill", hex: "#rrggbb" }                                      (any geometry)',
        '  { kind: "padding", top?, right?, bottom?, left? }                     (auto-layout frame)',
        '  { kind: "gap", value: number }                                        (auto-layout frame)',
        '  { kind: "sizing", w?: "FILL"|"HUG"|number, h?: ... }                  (auto-layout frame)',
        '  { kind: "rename", name: string }',
        '  { kind: "visibility", visible: boolean }',
        '  { kind: "remove" }',
      ].join("\n"),
      {
        id: z.string().describe("Node id to modify"),
        changes: z.array(z.any()).describe("Ordered list of NodeChange items (see description)"),
      },
      async (input) => dispatchAndPack(router, "modify_node", input),
    ),

    tool(
      "swap_theme",
      "Flip the current page between Light and Dark mode by setting the explicit mode on the Hydrogen DS theme variable collection.",
      { target: z.enum(["light", "dark"]) },
      async (input) => dispatchAndPack(router, "swap_theme", input),
    ),

    tool(
      "swap_density",
      "Flip the current page between Regular and Compact density (spacing + radius scale) by setting the explicit mode on the Hydrogen DS density variable collection.",
      { target: z.enum(["regular", "compact"]) },
      async (input) => dispatchAndPack(router, "swap_density", input),
    ),

    tool(
      "read_selection",
      "Inspect what the designer currently has selected on the Figma canvas. Returns id, name, type, and bounding box for each selected node.",
      {},
      async () => dispatchAndPack(router, "read_selection", {}),
    ),

    tool(
      "get_canvas_state",
      "Get the current page name, viewport bounds, and a suggested empty-space drop position. Useful before placing a new template.",
      {},
      async () => dispatchAndPack(router, "get_canvas_state", {}),
    ),

    tool(
      "figma_execute",
      [
        "Escape hatch — run arbitrary JS in the plugin sandbox with the `figma` global available.",
        "",
        "PREFER the declarative tools (insert_template, insert_component, modify_node, emit_recipe, swap_theme, swap_density) when they cover the task — they're safer, validated, and undo-grouped.",
        "Reach for figma_execute ONLY when no declarative tool fits — e.g. setting strokes, effects, layout grids, exporting paths, custom multi-step traversals.",
        "",
        "The code is wrapped as `(async function() { <code> })()`. Use top-level `await` freely; `return` a JSON-serializable value if you need the result back.",
        "Always call `await figma.loadFontAsync(...)` before setting `text.characters`.",
        "Wrap multi-page traversals with `await figma.loadAllPagesAsync()` first.",
        "",
        "Example: set a node's stroke",
        "  `const n = await figma.getNodeByIdAsync('123:45'); n.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }]; n.strokeWeight = 1;`",
      ].join("\n"),
      {
        code: z.string().describe("JavaScript body to execute. `figma` is in scope."),
      },
      async (input) => dispatchAndPack(router, "figma_execute", input),
    ),

    tool(
      "get_styles",
      [
        "List Hydrogen DS text / paint / effect styles. Returns style id + key + name + (for text) font + size + line-height.",
        "Use this to discover the right `styleId` for `text` recipes — e.g. 'Display lg/Semibold', 'Text md/Regular'.",
        "By default lists DS-published styles (read from baked data). Pass `scope: 'local'` to inspect the current file's local styles instead (rare).",
      ].join("\n"),
      {
        scope: z.enum(["ds", "local"]).optional().default("ds"),
        kind: z.enum(["all", "text", "paint", "effect"]).optional().default("all"),
        search: z.string().optional().describe("Case-insensitive substring match on style name"),
      },
      async (input) => {
        if (input.scope === "local") {
          return dispatchAndPack(router, "get_styles", input);
        }
        const all = await loadStyles();
        const q = (input.search ?? "").toLowerCase();
        const match = (n: string) => !q || n.toLowerCase().includes(q);
        const kind = input.kind ?? "all";
        const result: Record<string, unknown> = {};
        if (kind === "all" || kind === "text") result.textStyles = all.textStyles.filter((s) => match(s.name));
        if (kind === "all" || kind === "paint") result.paintStyles = all.paintStyles.filter((s) => match(s.name));
        if (kind === "all" || kind === "effect") result.effectStyles = all.effectStyles.filter((s) => match(s.name));
        return jsonContent(result);
      },
    ),

    tool(
      "get_variables",
      "List local variable collections and their variables. Hydrogen DS tokens (colors, spacing, radius) are exposed as variables. Returns collection ids, modes (Light/Dark, Regular/Compact), and each variable's id + per-mode value.",
      {
        collectionName: z.string().optional().describe("Filter collections by case-insensitive substring on name"),
      },
      async (input) => dispatchAndPack(router, "get_variables", input),
    ),

    tool(
      "capture_template",
      [
        "Capture the designer's current selection (or a specific node) as a reusable template. The walker handles INSTANCE, FRAME, TEXT, and falls back to a positioned stub for raw shapes. Lenient — non-DS nodes are preserved with warnings, never refused.",
        "",
        "After capture the bridge writes the recipe + metadata to `~/.poseidon/templates/<slug>.json`, so it appears in `list_templates` with `origin: \"user\"` and is instantly usable via `insert_template`.",
        "",
        "Always confirm name + category with the designer first (use ask_user) — capture is cheap, but renames/relocations after save aren't, so get the metadata right at save time.",
      ].join("\n"),
      {
        rootId: z.string().optional().describe("Node id to capture; defaults to current selection"),
        name: z.string().describe("Human-readable template name (e.g. 'Settings · Billing')"),
        category: z.string().describe("Dashboard / List / Detail / Form / Onboarding / Error / Other / custom"),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
      },
      async (input) => {
        const captureResult = await router.dispatch("capture_template", input);
        if (!captureResult.ok) {
          return { ...jsonContent({ error: captureResult.code, message: captureResult.message }), isError: true };
        }
        // Persist to user dir.
        const v = captureResult.value as {
          slug: string;
          meta: { name: string; category: string; description: string; tags: string[]; width: number; height: number };
          recipe: unknown;
          validation: { warnings: string[] };
        };
        const saved = await saveUser({
          slug: v.slug,
          name: v.meta.name,
          category: v.meta.category,
          description: v.meta.description,
          tags: v.meta.tags,
          width: v.meta.width,
          height: v.meta.height,
          recipe: v.recipe,
        });
        return jsonContent({
          ok: true,
          slug: saved.slug,
          filePath: saved.filePath,
          warnings: v.validation.warnings,
        });
      },
    ),

    tool(
      "ask_user",
      [
        "Pause and ask the designer a clarifying question. Use SPARINGLY — only when proceeding would otherwise require guessing on a load-bearing decision (e.g. between two equally-good templates, picking a destructive option, naming a template).",
        "",
        "If `options` is provided, the plugin renders them as buttons. Otherwise the designer gets a free-text input.",
        "",
        "Returns { answer: string, cancelled: boolean }. If cancelled, treat it as 'no answer' and ask if they want to try again or change approach.",
      ].join("\n"),
      {
        question: z.string().describe("Plain-language question (markdown-light: bold, italic, line breaks allowed)"),
        options: z.array(z.string()).optional().describe("Up to 4 button choices; omit for free-text input"),
        defaultOption: z.string().optional().describe("Pre-highlighted option (must be one of `options`)"),
      },
      async (input) => dispatchAndPack(router, "ask_user", input),
    ),

    tool(
      "capture_screenshot",
      "Export a node as a base64-encoded PNG so you (the model) can see what you just built. Useful after `insert_template` / `emit_recipe` to verify the result visually before reporting back to the designer.",
      {
        nodeId: z.string().optional().describe("Node id to capture; defaults to current selection if omitted"),
        scale: z.number().optional().default(1).describe("Export scale (0.25 .. 4)"),
        format: z.enum(["PNG", "JPG", "SVG"]).optional().default("PNG"),
      },
      async (input) => dispatchAndPack(router, "capture_screenshot", input),
    ),
  ];
}

export function buildPoseidonMcpServer(router: ToolRouter) {
  return createSdkMcpServer({
    name: "poseidon",
    version: "0.1.0",
    tools: createPoseidonTools(router),
  });
}
