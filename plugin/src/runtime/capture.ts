/**
 * capture.ts — figma node tree → Recipe.
 *
 * Reverse of `instantiate.ts`. Walks any SceneNode and emits a Recipe that
 * `instantiate()` can rebuild. Same code is used by:
 *
 *   - Phase 7  `capture_template` tool (designer "Save as template")
 *   - Phase 7  one-off bake: walk each of the 18 DS templates and write
 *              full recipes into `data/templates.json` so `insert_template`
 *              can stop emitting stubs.
 *
 * Lenient mode: nodes we can't faithfully serialize (raw shapes, vector
 * paths, locked SVG illustrations, etc.) become `kind: "frame"` placeholders
 * with their bounding box + a warning. The walker NEVER refuses to walk —
 * it always returns a usable recipe + a list of warnings.
 */

import type {
  FrameNode as FrameRecipe,
  InstanceNode as InstanceRecipe,
  Node as RecipeNode,
  Padding,
  Sizing,
  TextNode as TextRecipe,
} from "./schema.ts";

export interface CaptureResult {
  recipe: RecipeNode;
  /** Non-fatal issues — non-DS nodes, raw-hex fills, missing keys. */
  warnings: string[];
  /** Diagnostic counts. */
  stats: { nodes: number; instances: number; texts: number; frames: number; stubs: number };
}

export interface CaptureOptions {
  /** Max depth to walk. Default 16 — enough for templates without runaway. */
  maxDepth?: number;
  /** When true (default), prefer token references over raw hex on fills. */
  preferTokens?: boolean;
}

export async function captureNode(
  root: SceneNode,
  options: CaptureOptions = {},
): Promise<CaptureResult> {
  const ctx: CaptureContext = {
    warnings: [],
    stats: { nodes: 0, instances: 0, texts: 0, frames: 0, stubs: 0 },
    maxDepth: options.maxDepth ?? 16,
    preferTokens: options.preferTokens ?? true,
  };
  const recipe = await walk(root, ctx, 0);
  return { recipe, warnings: ctx.warnings, stats: ctx.stats };
}

// ─── Internals ───────────────────────────────────────────────────────────

interface CaptureContext {
  warnings: string[];
  stats: CaptureResult["stats"];
  maxDepth: number;
  preferTokens: boolean;
}

async function walk(
  node: SceneNode,
  ctx: CaptureContext,
  depth: number,
  parentLayout?: "VERTICAL" | "HORIZONTAL" | "NONE",
): Promise<RecipeNode> {
  ctx.stats.nodes++;
  if (depth >= ctx.maxDepth) {
    ctx.warnings.push(`maxDepth reached at ${node.name} (${node.type}) — stubbing`);
    return stubFor(node);
  }

  let recipe: RecipeNode;
  if (node.type === "INSTANCE") recipe = await walkInstance(node, ctx);
  else if (node.type === "TEXT") recipe = await walkText(node, ctx);
  else if (node.type === "FRAME" || node.type === "COMPONENT" || node.type === "GROUP") {
    recipe = await walkFrame(node as FrameNode, ctx, depth);
  } else {
    // RECTANGLE / VECTOR / LINE / etc. — represent as bounded frame placeholder.
    ctx.stats.stubs++;
    ctx.warnings.push(`${node.type} "${node.name}" preserved as raw frame`);
    recipe = stubFor(node);
  }

  // Capture position only when parent is absent or non-auto-layout. Inside
  // an auto-layout parent, x/y are derived by the layout engine — recording
  // them would just lock the instance to the source coordinates.
  if (
    (parentLayout === undefined || parentLayout === "NONE") &&
    "x" in node &&
    "y" in node
  ) {
    (recipe as { position?: { x: number; y: number } }).position = {
      x: Math.round(node.x),
      y: Math.round(node.y),
    };
  }
  return recipe;
}

// ─── INSTANCE ────────────────────────────────────────────────────────────

async function walkInstance(node: InstanceNode, ctx: CaptureContext): Promise<InstanceRecipe> {
  ctx.stats.instances++;
  const main = await node.getMainComponentAsync();
  const isSetMember = main?.parent?.type === "COMPONENT_SET";

  // IMPORTANT: `importComponentByKeyAsync` requires a COMPONENT (variant)
  // key — passing a COMPONENT_SET key returns 404. So we always save the
  // main component's own key, and let `setProperties(variant)` re-select
  // the captured variant on instantiate.
  const key = main?.key ?? "";

  if (!key) {
    ctx.warnings.push(`instance "${node.name}" has no resolvable key`);
  }

  const variant: Record<string, string> = {};
  if (isSetMember && main) {
    // Parse "Type=Primary, Size=Medium" from the variant node's name.
    for (const pair of main.name.split(",")) {
      const eq = pair.indexOf("=");
      if (eq > 0) variant[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
    }
  }

  // Collect any text overrides by walking nested TEXT descendants and
  // recording (name, characters) where chars differ from the source default.
  const textOverrides: Record<string, string> = {};
  await collectTextOverrides(node, main, textOverrides);

  return {
    kind: "instance",
    key,
    variant: Object.keys(variant).length ? variant : undefined,
    textOverrides: Object.keys(textOverrides).length ? textOverrides : undefined,
    name: node.name,
  };
}

async function collectTextOverrides(
  instance: InstanceNode,
  main: ComponentNode | null,
  out: Record<string, string>,
): Promise<void> {
  if (!main) return;
  // Map source text by name → default chars.
  const sourceText = new Map<string, string>();
  function collectSource(n: BaseNode): void {
    if (n.type === "TEXT") sourceText.set(n.name, n.characters);
    if ("children" in n) for (const c of n.children) collectSource(c);
  }
  collectSource(main);

  function collectInstance(n: BaseNode): void {
    if (n.type === "TEXT") {
      const def = sourceText.get(n.name);
      if (def !== undefined && def !== n.characters) {
        out[n.name] = n.characters;
      }
    }
    if ("children" in n) for (const c of n.children) collectInstance(c);
  }
  collectInstance(instance);
}

// ─── TEXT ────────────────────────────────────────────────────────────────

async function walkText(node: TextNode, ctx: CaptureContext): Promise<TextRecipe> {
  ctx.stats.texts++;
  const styleId = typeof node.textStyleId === "string" ? node.textStyleId : undefined;
  const colorToken = ctx.preferTokens ? await readFillToken(node) : null;
  const fallbackHex = !colorToken ? readFillHex(node) : null;

  return {
    kind: "text",
    chars: node.characters,
    align:
      node.textAlignHorizontal === "LEFT" || node.textAlignHorizontal === "CENTER" || node.textAlignHorizontal === "RIGHT"
        ? node.textAlignHorizontal
        : undefined,
    styleId,
    colorToken: colorToken ?? fallbackHex ?? undefined,
    name: node.name,
  };
}

// ─── FRAME ───────────────────────────────────────────────────────────────

async function walkFrame(node: FrameNode, ctx: CaptureContext, depth: number): Promise<FrameRecipe> {
  ctx.stats.frames++;
  const layoutMode: "VERTICAL" | "HORIZONTAL" | "NONE" =
    node.layoutMode === "HORIZONTAL" || node.layoutMode === "VERTICAL" ? node.layoutMode : "NONE";
  const children: RecipeNode[] = [];
  for (const child of node.children) {
    children.push(await walk(child, ctx, depth + 1, layoutMode));
  }

  const fillToken = ctx.preferTokens ? await readFillToken(node) : null;
  const fallbackHex = !fillToken ? readFillHex(node) : null;

  const sizing: Sizing = {};
  if (node.layoutSizingHorizontal === "FILL") sizing.w = "FILL";
  else if (node.layoutSizingHorizontal === "HUG") sizing.w = "HUG";
  else sizing.w = node.width;
  if (node.layoutSizingVertical === "FILL") sizing.h = "FILL";
  else if (node.layoutSizingVertical === "HUG") sizing.h = "HUG";
  else sizing.h = node.height;

  const padding = readPadding(node);

  // Plugin API exposes additional layout modes (GRID) + counter alignments
  // (BASELINE) that our schema doesn't yet model — normalize/drop them.
  const layout: FrameRecipe["layout"] =
    node.layoutMode === "HORIZONTAL" || node.layoutMode === "VERTICAL" ? node.layoutMode : "NONE";

  const counter =
    node.counterAxisAlignItems === "MIN" ||
    node.counterAxisAlignItems === "CENTER" ||
    node.counterAxisAlignItems === "MAX"
      ? node.counterAxisAlignItems
      : undefined;

  return {
    kind: "frame",
    name: node.name,
    layout,
    padding,
    gap: typeof node.itemSpacing === "number" ? node.itemSpacing : undefined,
    sizing,
    fill: fillToken ?? fallbackHex ?? undefined,
    cornerRadius: typeof node.cornerRadius === "number" ? node.cornerRadius : undefined,
    align:
      node.primaryAxisAlignItems || counter
        ? { primary: node.primaryAxisAlignItems, counter }
        : undefined,
    children,
  };
}

function readPadding(node: FrameNode): Padding | undefined {
  const t = node.paddingTop ?? 0;
  const r = node.paddingRight ?? 0;
  const b = node.paddingBottom ?? 0;
  const l = node.paddingLeft ?? 0;
  if (t === 0 && r === 0 && b === 0 && l === 0) return undefined;
  if (t === r && r === b && b === l) return t;
  return { top: t, right: r, bottom: b, left: l };
}

// ─── Fill helpers ────────────────────────────────────────────────────────

async function readFillToken(node: SceneNode): Promise<string | null> {
  const bound = (node as unknown as { boundVariables?: Record<string, Array<{ id: string }> | { id: string }> })
    .boundVariables;
  if (!bound) return null;
  const fillsRef = (bound.fills ?? bound.fill) as Array<{ id: string }> | { id: string } | undefined;
  const refId = Array.isArray(fillsRef) ? fillsRef[0]?.id : fillsRef?.id;
  if (!refId) return null;
  try {
    const v = await figma.variables.getVariableByIdAsync(refId);
    return v ? `var(${v.name})` : null;
  } catch {
    return null;
  }
}

function readFillHex(node: SceneNode): string | null {
  const fills = (node as { fills?: ReadonlyArray<Paint> | symbol }).fills;
  if (!fills || !Array.isArray(fills) || fills.length === 0) return null;
  const f = fills[0];
  if (f.type !== "SOLID") return null;
  const { r, g, b } = f.color;
  const hex = (n: number) => Math.round(n * 255).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

// ─── Raw stub fallback ───────────────────────────────────────────────────

function stubFor(node: SceneNode): FrameRecipe {
  return {
    kind: "frame",
    name: node.name,
    layout: "NONE",
    sizing: {
      w: "width" in node ? (node as unknown as { width: number }).width : 0,
      h: "height" in node ? (node as unknown as { height: number }).height : 0,
    },
    fill: readFillHex(node) ?? "#f5f5f7",
    children: [],
  };
}
