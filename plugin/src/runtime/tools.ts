/**
 * Sandbox-side tool registry.
 *
 * The bridge dispatches Claude's tool calls to the plugin via SSE
 * `tool_request` events. The plugin UI forwards them to the sandbox via
 * postMessage. The sandbox looks up the tool here, executes it, and posts
 * the result back. The UI sends it back to the bridge.
 *
 * Tools that need `figma.*` live here. Tools that only read pre-baked JSON
 * (e.g. `list_templates`, `list_components`) live in `bridge/src/tools.ts`
 * instead — no need to round-trip if the bridge already has the data.
 *
 * Phase 4 implements:
 *   - insert_template  (stub instantiation, full recipes in Phase 5)
 *   - read_selection
 *   - get_canvas_state
 *
 * Phase 5 fills in: insert_component, emit_recipe, modify_node,
 *                   swap_theme, swap_density, ask_user, capture_template
 */

import { instantiate } from "./instantiate.ts";
import { captureNode, type CaptureResult } from "./capture.ts";
import type { Node as RecipeNode } from "./schema.ts";

// ─── Tool result shape ──────────────────────────────────────────────────

export interface ToolErrorResult {
  ok: false;
  code: string;
  message: string;
}
export interface ToolOkResult<T> {
  ok: true;
  value: T;
}
export type ToolResult<T> = ToolOkResult<T> | ToolErrorResult;

function ok<T>(value: T): ToolOkResult<T> {
  return { ok: true, value };
}
function err(code: string, message: string): ToolErrorResult {
  return { ok: false, code, message };
}

// ─── Tool definitions ────────────────────────────────────────────────────

/**
 * insert_template — Phase 4 builds a labelled stub frame. Phase 5 swaps in
 * the real recipe walker once seed-templates.json carries full trees.
 */
export interface InsertTemplateInput {
  slug: string;
  name: string;
  width: number;
  height: number;
  position?: { x: number; y: number };
}
export interface InsertTemplateOutput {
  rootId: string;
  insertedCount: number;
  warnings: string[];
}

async function insertTemplate(
  input: InsertTemplateInput,
): Promise<ToolResult<InsertTemplateOutput>> {
  const recipe: RecipeNode = {
    kind: "stub",
    label: `${input.name}\n(stub — full recipe in Phase 5)`,
    width: input.width,
    height: input.height,
    name: input.name,
  };

  const result = await instantiate(recipe, {
    position: input.position ?? findEmptySpace(input.width, input.height),
  });

  // Bring it into view.
  const node = await figma.getNodeByIdAsync(result.rootId);
  if (node && "id" in node) {
    figma.currentPage.selection = [node as SceneNode];
    figma.viewport.scrollAndZoomIntoView([node as SceneNode]);
  }

  return ok(result);
}

/**
 * insert_component — drop a single DS component instance on the canvas.
 * Resolves via `importComponentByKeyAsync`. Applies variant overrides if
 * supplied.
 */
export interface InsertComponentInput {
  key: string;
  variant?: Record<string, string>;
  /** layer-name → new chars. Walked depth-first across all TEXT descendants. */
  textOverrides?: Record<string, string>;
  position?: { x: number; y: number };
  parentId?: string;
  name?: string;
}
export interface InsertComponentOutput {
  rootId: string;
  appliedVariant: Record<string, string> | null;
  appliedTextOverrides: Array<{ name: string; chars: string }>;
  warnings: string[];
}

async function insertComponent(
  input: InsertComponentInput,
): Promise<ToolResult<InsertComponentOutput>> {
  const recipe: RecipeNode = {
    kind: "instance",
    key: input.key,
    variant: input.variant,
    name: input.name,
  };

  let parent: BaseNode & ChildrenMixin = figma.currentPage;
  if (input.parentId) {
    const found = await figma.getNodeByIdAsync(input.parentId);
    if (found && "appendChild" in found) {
      parent = found as BaseNode & ChildrenMixin;
    }
  }

  const result = await instantiate(recipe, {
    position: input.position ?? findEmptySpace(120, 40),
    parent,
  });

  // Apply text overrides — walk TEXT descendants by name.
  const appliedTextOverrides: Array<{ name: string; chars: string }> = [];
  if (input.textOverrides && Object.keys(input.textOverrides).length > 0) {
    const root = await figma.getNodeByIdAsync(result.rootId);
    if (root) {
      await applyTextOverrides(root as SceneNode, input.textOverrides, appliedTextOverrides);
    }
  }

  const node = await figma.getNodeByIdAsync(result.rootId);
  if (node && "id" in node) {
    figma.currentPage.selection = [node as SceneNode];
    figma.viewport.scrollAndZoomIntoView([node as SceneNode]);
  }

  return ok({
    rootId: result.rootId,
    appliedVariant: input.variant ?? null,
    appliedTextOverrides,
    warnings: result.warnings,
  });
}

/**
 * Walk a node tree and replace `characters` on any TEXT node whose `name`
 * matches a key in `overrides`. Loads fonts on demand.
 *
 * If `overrides` has exactly one entry whose key doesn't match any TEXT
 * node name, we fall back to applying it to the FIRST text node — handles
 * the common "I just want to change the only label" case where the model
 * passed `{ label: "..." }` instead of the actual layer name.
 */
async function applyTextOverrides(
  root: SceneNode,
  overrides: Record<string, string>,
  applied: Array<{ name: string; chars: string }>,
): Promise<void> {
  const texts: TextNode[] = [];
  function collect(node: SceneNode | BaseNode): void {
    if (node.type === "TEXT") texts.push(node);
    if ("children" in node) {
      for (const c of node.children) collect(c);
    }
  }
  collect(root);
  if (texts.length === 0) return;

  const overrideKeys = Object.keys(overrides);
  const matched = new Set<TextNode>();

  // First pass: exact name match (case-sensitive).
  for (const t of texts) {
    if (overrides[t.name] !== undefined && !matched.has(t)) {
      const fontName = t.fontName;
      if (typeof fontName !== "symbol") await figma.loadFontAsync(fontName);
      t.characters = overrides[t.name];
      applied.push({ name: t.name, chars: overrides[t.name] });
      matched.add(t);
    }
  }

  // Second pass: case-insensitive match.
  if (matched.size < overrideKeys.length) {
    const lowerOverrides = new Map(
      Object.entries(overrides).map(([k, v]) => [k.toLowerCase(), v]),
    );
    for (const t of texts) {
      if (matched.has(t)) continue;
      const v = lowerOverrides.get(t.name.toLowerCase());
      if (v !== undefined) {
        const fontName = t.fontName;
        if (typeof fontName !== "symbol") await figma.loadFontAsync(fontName);
        t.characters = v;
        applied.push({ name: t.name, chars: v });
        matched.add(t);
      }
    }
  }

  // Fallback: single override + no match → apply to first TEXT.
  if (overrideKeys.length === 1 && matched.size === 0 && texts.length > 0) {
    const t = texts[0];
    const v = overrides[overrideKeys[0]];
    const fontName = t.fontName;
    if (typeof fontName !== "symbol") await figma.loadFontAsync(fontName);
    t.characters = v;
    applied.push({ name: t.name, chars: v });
  }
}

/** read_selection — returns a summary of what the designer has selected. */
export interface ReadSelectionOutput {
  count: number;
  nodes: Array<{
    id: string;
    name: string;
    type: string;
    width: number;
    height: number;
  }>;
}

async function readSelection(): Promise<ToolResult<ReadSelectionOutput>> {
  const sel = figma.currentPage.selection;
  return ok({
    count: sel.length,
    nodes: sel.map((n) => ({
      id: n.id,
      name: n.name,
      type: n.type,
      width: n.width,
      height: n.height,
    })),
  });
}

/**
 * emit_recipe — free-form node tree from Claude. Used when no template /
 * single component fits the request and Claude wants to compose something
 * bespoke. Same walker as templates, just from a Claude-authored Recipe.
 */
export interface EmitRecipeInput {
  recipe: RecipeNode;
  position?: { x: number; y: number };
  parentId?: string;
}
export interface EmitRecipeOutput {
  rootId: string;
  insertedCount: number;
  warnings: string[];
}

async function emitRecipe(input: EmitRecipeInput): Promise<ToolResult<EmitRecipeOutput>> {
  let parent: BaseNode & ChildrenMixin = figma.currentPage;
  if (input.parentId) {
    const found = await figma.getNodeByIdAsync(input.parentId);
    if (found && "appendChild" in found) parent = found as BaseNode & ChildrenMixin;
  }

  const result = await instantiate(input.recipe, {
    position: input.position ?? findEmptySpace(400, 300),
    parent,
  });

  const node = await figma.getNodeByIdAsync(result.rootId);
  if (node && "id" in node) {
    figma.currentPage.selection = [node as SceneNode];
    figma.viewport.scrollAndZoomIntoView([node as SceneNode]);
  }
  return ok(result);
}

/**
 * modify_node — edit an existing node. Accepts a list of changes applied
 * in order. Skips any change that doesn't fit the target node type and
 * records the reason.
 */
export type NodeChange =
  | { kind: "text"; chars: string }
  | { kind: "variant"; props: Record<string, string> }
  | { kind: "fill"; hex: string }
  | { kind: "padding"; top?: number; right?: number; bottom?: number; left?: number }
  | { kind: "gap"; value: number }
  | { kind: "sizing"; w?: "FILL" | "HUG" | number; h?: "FILL" | "HUG" | number }
  | { kind: "rename"; name: string }
  | { kind: "visibility"; visible: boolean }
  | { kind: "remove" };

export interface ModifyNodeInput {
  id: string;
  changes: NodeChange[];
}
export interface ModifyNodeOutput {
  id: string;
  appliedCount: number;
  skipped: Array<{ index: number; reason: string }>;
}

async function modifyNode(input: ModifyNodeInput): Promise<ToolResult<ModifyNodeOutput>> {
  const node = await figma.getNodeByIdAsync(input.id);
  if (!node) return err("NOT_FOUND", `no node with id ${input.id}`);

  let applied = 0;
  const skipped: Array<{ index: number; reason: string }> = [];

  for (let i = 0; i < input.changes.length; i++) {
    const c = input.changes[i];
    try {
      switch (c.kind) {
        case "text": {
          if (node.type !== "TEXT") {
            skipped.push({ index: i, reason: "not a text node" });
            break;
          }
          const fontName = (node as TextNode).fontName;
          if (typeof fontName !== "symbol") await figma.loadFontAsync(fontName);
          (node as TextNode).characters = c.chars;
          applied++;
          break;
        }
        case "variant": {
          if (node.type !== "INSTANCE") {
            skipped.push({ index: i, reason: "not an instance" });
            break;
          }
          (node as InstanceNode).setProperties(c.props);
          applied++;
          break;
        }
        case "fill": {
          if (!("fills" in node)) {
            skipped.push({ index: i, reason: "node has no fills" });
            break;
          }
          (node as GeometryMixin).fills = [{ type: "SOLID", color: hexToRgbForNode(c.hex) }];
          applied++;
          break;
        }
        case "padding": {
          if (!("paddingTop" in node)) {
            skipped.push({ index: i, reason: "node has no padding" });
            break;
          }
          const f = node as FrameNode;
          if (c.top !== undefined) f.paddingTop = c.top;
          if (c.right !== undefined) f.paddingRight = c.right;
          if (c.bottom !== undefined) f.paddingBottom = c.bottom;
          if (c.left !== undefined) f.paddingLeft = c.left;
          applied++;
          break;
        }
        case "gap": {
          if (!("itemSpacing" in node)) {
            skipped.push({ index: i, reason: "node has no auto-layout gap" });
            break;
          }
          (node as FrameNode).itemSpacing = c.value;
          applied++;
          break;
        }
        case "sizing": {
          if (!("layoutSizingHorizontal" in node)) {
            skipped.push({ index: i, reason: "node has no layout sizing" });
            break;
          }
          const f = node as FrameNode;
          if (c.w === "FILL" || c.w === "HUG") f.layoutSizingHorizontal = c.w;
          else if (typeof c.w === "number") f.resize(c.w, f.height);
          if (c.h === "FILL" || c.h === "HUG") f.layoutSizingVertical = c.h;
          else if (typeof c.h === "number") f.resize(f.width, c.h);
          applied++;
          break;
        }
        case "rename":
          node.name = c.name;
          applied++;
          break;
        case "visibility":
          if (!("visible" in node)) {
            skipped.push({ index: i, reason: "node has no visibility" });
            break;
          }
          (node as SceneNode).visible = c.visible;
          applied++;
          break;
        case "remove":
          if (!("remove" in node)) {
            skipped.push({ index: i, reason: "node cannot be removed" });
            break;
          }
          (node as SceneNode).remove();
          applied++;
          break;
      }
    } catch (e) {
      skipped.push({ index: i, reason: String((e as Error).message ?? e) });
    }
  }

  return ok({ id: input.id, appliedCount: applied, skipped });
}

function hexToRgbForNode(hex: string): RGB {
  const m = hex.replace("#", "");
  const n = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const num = parseInt(n, 16);
  return {
    r: ((num >> 16) & 0xff) / 255,
    g: ((num >> 8) & 0xff) / 255,
    b: (num & 0xff) / 255,
  };
}

/**
 * swap_theme / swap_density — flip the variable mode on the current page's
 * Hydrogen DS variable collections. Hydrogen exposes Light/Dark and
 * Regular/Compact as separate collections; we find the one whose modes
 * contain the requested name and set it on the page.
 */
async function swapMode(target: string, kind: "theme" | "density"): Promise<ToolResult<{ collectionName: string; previous: string; current: string }>> {
  const collections = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
  const lower = target.toLowerCase();

  for (const c of collections) {
    if (!c.libraryName.toLowerCase().includes("hydrogen")) continue;
    // We can't read remote collection modes without importing; instead,
    // use the locally-imported collections on the page.
  }

  // Fallback: look at local variable collections on the page.
  const localCollections = await figma.variables.getLocalVariableCollectionsAsync();
  for (const coll of localCollections) {
    const matchingMode = coll.modes.find((m) => m.name.toLowerCase().includes(lower));
    if (matchingMode) {
      // Plugin API has no getter for the page's explicit mode; we can only
      // report the default mode as "previous" — close enough for chat UI.
      const previousName =
        coll.modes.find((m) => m.modeId === coll.defaultModeId)?.name ?? "(unknown)";
      figma.currentPage.setExplicitVariableModeForCollection(coll, matchingMode.modeId);
      return ok({ collectionName: coll.name, previous: previousName, current: matchingMode.name });
    }
  }

  return err(
    "NO_MATCHING_MODE",
    `no local variable collection has a ${kind} mode matching '${target}'. Make sure the Hydrogen library is enabled and the variable collection is imported into this file.`,
  );
}

async function swapTheme(input: { target: "light" | "dark" }): Promise<ToolResult<{ collectionName: string; previous: string; current: string }>> {
  return swapMode(input.target, "theme");
}

async function swapDensity(input: { target: "regular" | "compact" }): Promise<ToolResult<{ collectionName: string; previous: string; current: string }>> {
  return swapMode(input.target, "density");
}

/** get_canvas_state — page name + viewport + empty-space candidates. */
export interface GetCanvasStateOutput {
  pageId: string;
  pageName: string;
  viewport: { x: number; y: number; width: number; height: number; zoom: number };
  emptySpaces: Array<{ x: number; y: number }>;
}

async function getCanvasState(): Promise<ToolResult<GetCanvasStateOutput>> {
  return ok({
    pageId: figma.currentPage.id,
    pageName: figma.currentPage.name,
    viewport: {
      x: figma.viewport.bounds.x,
      y: figma.viewport.bounds.y,
      width: figma.viewport.bounds.width,
      height: figma.viewport.bounds.height,
      zoom: figma.viewport.zoom,
    },
    emptySpaces: [findEmptySpace(1440, 1024)],
  });
}

/**
 * capture_template — walk a node tree → Recipe (no filesystem write).
 *
 * Sandbox half only. The bridge wraps this: receives the recipe + metadata,
 * writes the JSON to `~/.poseidon/templates/<slug>.json` (or the repo dir
 * when `destination: "repo"`), and merges the new entry into the live
 * templates index. See bridge/src/tools.ts.
 */
export interface CaptureTemplateInput {
  rootId?: string;
  name: string;
  category: string;
  description?: string;
  tags?: string[];
}
export interface CaptureTemplateOutput {
  slug: string;
  meta: {
    name: string;
    category: string;
    description: string;
    tags: string[];
    width: number;
    height: number;
  };
  recipe: RecipeNode;
  validation: CaptureResult["stats"] & { warnings: string[] };
}

async function captureTemplate(
  input: CaptureTemplateInput,
): Promise<ToolResult<CaptureTemplateOutput>> {
  let target: SceneNode | null = null;
  if (input.rootId) {
    const n = await figma.getNodeByIdAsync(input.rootId);
    if (!n) return err("NOT_FOUND", `no node ${input.rootId}`);
    if (!("type" in n)) return err("INVALID_INPUT", `node ${input.rootId} has no type`);
    target = n as SceneNode;
  } else {
    const sel = figma.currentPage.selection;
    if (sel.length === 0) return err("INVALID_INPUT", "no rootId and nothing selected");
    target = sel[0];
  }

  if (!input.name?.trim()) return err("INVALID_INPUT", "name is required");

  const cap = await captureNode(target);

  const slug = input.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const w = "width" in target ? (target as unknown as { width: number }).width : 0;
  const h = "height" in target ? (target as unknown as { height: number }).height : 0;

  return ok({
    slug,
    meta: {
      name: input.name.trim(),
      category: input.category,
      description: (input.description ?? "").trim(),
      tags: input.tags ?? [],
      width: Math.round(w),
      height: Math.round(h),
    },
    recipe: cap.recipe,
    validation: { ...cap.stats, warnings: cap.warnings },
  });
}

/**
 * figma_execute — paperclip-style escape hatch.
 *
 * Runs arbitrary JS inside the plugin sandbox with `figma` in scope. The
 * code body is wrapped as `(async function() { <code> })()` so callers
 * can use top-level await + `return` a value.
 *
 * Auditable: each call shows the JS in the tool-call card. Reversible:
 * already wrapped in the per-turn `figma.commitUndo()` checkpoint.
 *
 * Use this only for things our declarative tools don't cover (strokes,
 * effects, layout grids, custom traversal, etc.) — Claude is instructed to
 * prefer declarative tools first.
 */
export interface FigmaExecuteInput {
  code: string;
}
async function figmaExecute(input: FigmaExecuteInput): Promise<ToolResult<unknown>> {
  if (!input.code || typeof input.code !== "string") {
    return err("INVALID_INPUT", "code must be a non-empty string");
  }
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function("figma", `return (async function() { ${input.code} })();`);
    const result = await fn(figma);
    return ok({ result });
  } catch (e) {
    return err("EXECUTION_FAILED", String((e as Error).message ?? e));
  }
}

/**
 * get_styles — list local + team-library text/paint/effect styles.
 *
 * Hydrogen DS publishes text styles like "Text md/Regular" and color styles.
 * Claude uses this to discover which styleIds it can pass into `text` or
 * `frame` recipes.
 */
export interface GetStylesInput {
  kind?: "all" | "text" | "paint" | "effect";
  search?: string;
}
export interface GetStylesOutput {
  textStyles: Array<{ id: string; name: string; description?: string }>;
  paintStyles: Array<{ id: string; name: string; description?: string }>;
  effectStyles: Array<{ id: string; name: string; description?: string }>;
}
async function getStyles(input: GetStylesInput = {}): Promise<ToolResult<GetStylesOutput>> {
  const kind = input.kind ?? "all";
  const q = (input.search ?? "").toLowerCase();
  const match = (n: string) => !q || n.toLowerCase().includes(q);

  const out: GetStylesOutput = { textStyles: [], paintStyles: [], effectStyles: [] };
  if (kind === "all" || kind === "text") {
    const styles = await figma.getLocalTextStylesAsync();
    out.textStyles = styles
      .filter((s) => match(s.name))
      .map((s) => ({ id: s.id, name: s.name, description: s.description || undefined }));
  }
  if (kind === "all" || kind === "paint") {
    const styles = await figma.getLocalPaintStylesAsync();
    out.paintStyles = styles
      .filter((s) => match(s.name))
      .map((s) => ({ id: s.id, name: s.name, description: s.description || undefined }));
  }
  if (kind === "all" || kind === "effect") {
    const styles = await figma.getLocalEffectStylesAsync();
    out.effectStyles = styles
      .filter((s) => match(s.name))
      .map((s) => ({ id: s.id, name: s.name, description: s.description || undefined }));
  }
  return ok(out);
}

/**
 * get_variables — list local variable collections + their variables.
 *
 * Hydrogen DS tokens are variables. Returns collection ids, modes, and
 * each variable's id, name, type, and per-mode values (where serializable).
 */
export interface GetVariablesInput {
  collectionName?: string;
}
export interface GetVariablesOutput {
  collections: Array<{
    id: string;
    name: string;
    modes: Array<{ modeId: string; name: string }>;
    defaultModeId: string;
    variableCount: number;
  }>;
  variables: Array<{
    id: string;
    name: string;
    type: string;
    collectionId: string;
    scopes: string[];
    valuesByMode?: Record<string, unknown>;
  }>;
}
async function getVariables(input: GetVariablesInput = {}): Promise<ToolResult<GetVariablesOutput>> {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const filtered = input.collectionName
    ? collections.filter((c) => c.name.toLowerCase().includes(input.collectionName!.toLowerCase()))
    : collections;

  const allVars = await figma.variables.getLocalVariablesAsync();
  const targetCollectionIds = new Set(filtered.map((c) => c.id));

  return ok({
    collections: filtered.map((c) => ({
      id: c.id,
      name: c.name,
      modes: c.modes.map((m) => ({ modeId: m.modeId, name: m.name })),
      defaultModeId: c.defaultModeId,
      variableCount: c.variableIds.length,
    })),
    variables: allVars
      .filter((v) => targetCollectionIds.has(v.variableCollectionId))
      .map((v) => ({
        id: v.id,
        name: v.name,
        type: v.resolvedType,
        collectionId: v.variableCollectionId,
        scopes: v.scopes,
        valuesByMode: serializableValuesByMode(v.valuesByMode),
      })),
  });
}

function serializableValuesByMode(
  raw: { [modeId: string]: VariableValue },
): Record<string, unknown> {
  // VariableValue is JSON-serializable primitives + simple RGBA objects +
  // alias refs. Pass through unchanged.
  return raw as Record<string, unknown>;
}

/**
 * capture_screenshot — export a node as base64-encoded PNG so Claude can
 * "see" what it built and reason about the result visually.
 */
export interface CaptureScreenshotInput {
  nodeId?: string;
  scale?: number;
  format?: "PNG" | "JPG" | "SVG";
}
export interface CaptureScreenshotOutput {
  nodeId: string;
  nodeName: string;
  width: number;
  height: number;
  format: string;
  base64: string;
  byteLength: number;
}
async function captureScreenshot(input: CaptureScreenshotInput): Promise<ToolResult<CaptureScreenshotOutput>> {
  let node: BaseNode | SceneNode | null = null;
  if (input.nodeId) {
    node = await figma.getNodeByIdAsync(input.nodeId);
    if (!node) return err("NOT_FOUND", `no node with id ${input.nodeId}`);
  } else {
    const sel = figma.currentPage.selection;
    if (sel.length === 0) return err("INVALID_INPUT", "no nodeId and no selection");
    node = sel[0];
  }

  if (!("exportAsync" in node)) {
    return err("INVALID_INPUT", `node ${node.id} is not exportable`);
  }
  const exportable = node as BaseNode & ExportMixin;

  const format = (input.format ?? "PNG") as "PNG" | "JPG" | "SVG";
  const scale = input.scale ?? 1;
  const bytes = await exportable.exportAsync({
    format,
    constraint: { type: "SCALE", value: scale },
  } as ExportSettings);

  return ok({
    nodeId: exportable.id,
    nodeName: exportable.name,
    width: "width" in exportable ? (exportable as unknown as { width: number }).width : 0,
    height: "height" in exportable ? (exportable as unknown as { height: number }).height : 0,
    format,
    base64: bytesToBase64(bytes as Uint8Array),
    byteLength: (bytes as Uint8Array).byteLength,
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.byteLength; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

// ─── Empty-space finder ──────────────────────────────────────────────────

/**
 * Place new content to the right of existing top-level nodes on the page.
 * Crude but predictable — designers can drag afterward. Phase 5 may add a
 * smarter solver.
 */
function findEmptySpace(_w: number, _h: number): { x: number; y: number } {
  const nodes = figma.currentPage.children;
  if (nodes.length === 0) return { x: 0, y: 0 };
  let maxRight = -Infinity;
  let topAtMax = 0;
  for (const n of nodes) {
    const right = n.x + n.width;
    if (right > maxRight) {
      maxRight = right;
      topAtMax = n.y;
    }
  }
  return { x: maxRight + 200, y: topAtMax };
}

// ─── Registry ────────────────────────────────────────────────────────────

export type ToolName =
  | "insert_template"
  | "insert_component"
  | "emit_recipe"
  | "modify_node"
  | "swap_theme"
  | "swap_density"
  | "read_selection"
  | "get_canvas_state"
  | "figma_execute"
  | "get_styles"
  | "get_variables"
  | "capture_screenshot"
  | "capture_template";

type Handler = (input: unknown) => Promise<ToolResult<unknown>>;

export const SANDBOX_TOOLS: Record<ToolName, Handler> = {
  insert_template: (input) => insertTemplate(input as InsertTemplateInput),
  insert_component: (input) => insertComponent(input as InsertComponentInput),
  emit_recipe: (input) => emitRecipe(input as EmitRecipeInput),
  modify_node: (input) => modifyNode(input as ModifyNodeInput),
  swap_theme: (input) => swapTheme(input as { target: "light" | "dark" }),
  swap_density: (input) => swapDensity(input as { target: "regular" | "compact" }),
  read_selection: () => readSelection(),
  get_canvas_state: () => getCanvasState(),
  figma_execute: (input) => figmaExecute(input as FigmaExecuteInput),
  get_styles: (input) => getStyles(input as GetStylesInput),
  get_variables: (input) => getVariables(input as GetVariablesInput),
  capture_screenshot: (input) => captureScreenshot(input as CaptureScreenshotInput),
  capture_template: (input) => captureTemplate(input as CaptureTemplateInput),
};

/**
 * Dispatcher used by the sandbox message handler.
 *
 * NOTE: undo grouping is handled at the *turn* level via `ui:turn-start` /
 * `ui:turn-end` messages from the chat UI (see sandbox/main.ts). We do NOT
 * commit between tools — that would fragment a single assistant turn into
 * multiple history entries.
 */
export async function runSandboxTool(
  name: string,
  input: unknown,
): Promise<ToolResult<unknown>> {
  const handler = SANDBOX_TOOLS[name as ToolName];
  if (!handler) {
    return err("UNKNOWN_TOOL", `no sandbox handler for tool '${name}'`);
  }
  try {
    return await handler(input);
  } catch (e) {
    return err("EXECUTION_FAILED", String((e as Error).message ?? e));
  }
}
