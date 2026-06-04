/**
 * instantiate.ts — recipe → figma node tree.
 *
 * Runs in the plugin sandbox. Only place that calls `figma.*`.
 *
 * Phase 4 ships handlers for:
 *   - "stub"     → labelled rectangle (Phase 4 proof-of-roundtrip)
 *   - "frame"    → frame with auto-layout, padding, sizing, fill
 *   - "instance" → DS component instance via importComponentByKeyAsync
 *   - "text"     → text with DS textStyleId + colorToken
 *
 * Phase 5 will add `modify_node` and the swap_theme/density tools. Phase 7
 * adds `capture.ts` (the reverse direction) but shares the same schema.
 */

import type {
  Dim,
  FrameNode as FrameRecipe,
  InstanceNode as InstanceRecipe,
  Node as RecipeNode,
  Padding,
  StubNode as StubRecipe,
  TextNode as TextRecipe,
} from "./schema.ts";

export interface InstantiateOptions {
  /** Top-left position for the root node (page coords). */
  position?: { x: number; y: number };
  /** Parent to append into. Defaults to current page. */
  parent?: BaseNode & ChildrenMixin;
}

export interface InstantiateResult {
  rootId: string;
  insertedCount: number;
  warnings: string[];
}

/**
 * Cache of DS variables looked up at instantiation time. We try (in order):
 *   1. Local variables in the current file (already imported by use).
 *   2. Variables baked into `data/variables.json` — name → key map from the
 *      DS file. (Phase 7.5 P1 — pending.)
 *
 * Lookups are case- and separator-insensitive: `color/text/01`,
 * `Color/Text/01`, `color.text.01` all match the same variable.
 *
 * Cleared at the end of each `instantiate()` so a subsequent run sees any
 * newly imported variables.
 */
let variableCache: Map<string, Variable> | null = null;

function canonicalizeName(name: string): string {
  return name.toLowerCase().replace(/[\s._-]+/g, "/").replace(/\/+/g, "/");
}

async function getVariableByTokenName(name: string): Promise<Variable | null> {
  if (!variableCache) {
    variableCache = new Map();
    try {
      const all = await figma.variables.getLocalVariablesAsync();
      for (const v of all) {
        // Keep both the original AND canonical forms so callers using
        // either layout match.
        variableCache.set(v.name, v);
        variableCache.set(canonicalizeName(v.name), v);
      }
    } catch {
      // No local variables — leave cache empty.
    }
  }
  return (
    variableCache.get(name) ??
    variableCache.get(canonicalizeName(name)) ??
    null
  );
}

function clearVariableCache(): void {
  variableCache = null;
}

/** Returns the token name from a `var(...)` reference, or null. */
function parseTokenRef(value: string | undefined): string | null {
  if (!value) return null;
  const m = value.match(/^var\(\s*([^)]+?)\s*\)$/);
  return m ? m[1] : null;
}

/** Single entry point — call this from the sandbox tool handler. */
export async function instantiate(
  root: RecipeNode,
  options: InstantiateOptions = {},
): Promise<InstantiateResult> {
  const warnings: string[] = [];
  const parent = options.parent ?? figma.currentPage;

  const node = await buildNode(root, warnings);
  parent.appendChild(node);

  if (options.position) {
    node.x = options.position.x;
    node.y = options.position.y;
  }

  // Stubs need a label child added after attach (label uses async font load).
  if (root.kind === "stub") {
    await decorateStub(node as FrameNode, root.label);
  }

  // Variables may be re-imported between calls — don't keep stale entries.
  clearVariableCache();

  return {
    rootId: node.id,
    insertedCount: countNodes(root),
    warnings,
  };
}

// ─── Node builders ───────────────────────────────────────────────────────

async function buildNode(node: RecipeNode, warnings: string[]): Promise<SceneNode> {
  switch (node.kind) {
    case "stub":
      return buildStub(node);
    case "frame":
      return buildFrame(node, warnings);
    case "instance":
      return buildInstance(node, warnings);
    case "text":
      return buildText(node, warnings);
    default: {
      const _exhaustive: never = node;
      throw new Error(`unknown recipe kind: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

// ─── stub ────────────────────────────────────────────────────────────────

function buildStub(n: StubRecipe): FrameNode {
  const frame = figma.createFrame();
  frame.name = n.name ?? n.label;
  frame.resize(n.width, n.height);
  frame.fills = [
    {
      type: "SOLID",
      color: hexToRgb(n.fill ?? "#f5f5f7"),
    },
  ];
  return frame;
}

/** Stubs need a label text child but text needs font loading first. Apply after build. */
async function decorateStub(frame: FrameNode, label: string): Promise<void> {
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  const t = figma.createText();
  t.fontName = { family: "Inter", style: "Regular" };
  t.fontSize = 13;
  t.characters = label;
  t.fills = [{ type: "SOLID", color: hexToRgb("#888888") }];
  t.textAlignHorizontal = "CENTER";
  t.textAlignVertical = "CENTER";
  frame.appendChild(t);
  t.x = (frame.width - t.width) / 2;
  t.y = (frame.height - t.height) / 2;
}

// ─── frame ───────────────────────────────────────────────────────────────

async function buildFrame(recipe: FrameRecipe, warnings: string[]): Promise<FrameNode> {
  const frame = figma.createFrame();
  if (recipe.name) frame.name = recipe.name;

  if (recipe.layout && recipe.layout !== "NONE") {
    frame.layoutMode = recipe.layout;
  }

  applyPadding(frame, recipe.padding);

  if (typeof recipe.gap === "number") {
    frame.itemSpacing = recipe.gap;
  }

  if (recipe.align) {
    if (recipe.align.primary) frame.primaryAxisAlignItems = recipe.align.primary;
    if (recipe.align.counter) frame.counterAxisAlignItems = recipe.align.counter;
  }

  if (recipe.fill) {
    await applyFill(frame, recipe.fill, warnings);
  } else {
    frame.fills = [];
  }

  if (recipe.cornerRadius !== undefined) {
    if (typeof recipe.cornerRadius === "number") {
      frame.cornerRadius = recipe.cornerRadius;
    } else {
      warnings.push(`token-bound cornerRadius not yet supported: ${recipe.cornerRadius}`);
    }
  }

  if (recipe.sizing?.w !== undefined && typeof recipe.sizing.w === "number") {
    frame.resize(recipe.sizing.w, frame.height);
  }
  if (recipe.sizing?.h !== undefined && typeof recipe.sizing.h === "number") {
    frame.resize(frame.width, recipe.sizing.h);
  }

  for (const child of recipe.children) {
    const built = await buildNode(child, warnings);
    frame.appendChild(built);
    // If the recipe carries an explicit position AND the frame's not using
    // auto-layout, restore the captured offset. In auto-layout the engine
    // owns x/y and any value we set gets overwritten anyway.
    const childPos = (child as { position?: { x: number; y: number } }).position;
    if (
      childPos &&
      (frame.layoutMode === "NONE" || frame.layoutMode === undefined) &&
      "x" in built &&
      "y" in built
    ) {
      (built as { x: number; y: number }).x = childPos.x;
      (built as { x: number; y: number }).y = childPos.y;
    }
  }

  // After children are in, apply hug/fill sizing (parent must exist).
  applyDimSizing(frame, recipe.sizing, warnings);

  return frame;
}

function applyPadding(frame: FrameNode, p?: Padding): void {
  if (p === undefined) return;
  if (typeof p === "number") {
    frame.paddingTop = p;
    frame.paddingRight = p;
    frame.paddingBottom = p;
    frame.paddingLeft = p;
    return;
  }
  if (p.top !== undefined) frame.paddingTop = p.top;
  if (p.right !== undefined) frame.paddingRight = p.right;
  if (p.bottom !== undefined) frame.paddingBottom = p.bottom;
  if (p.left !== undefined) frame.paddingLeft = p.left;
}

function applyDimSizing(frame: FrameNode, sizing?: { w?: Dim; h?: Dim }, _warnings?: string[]): void {
  if (!sizing) return;
  if (sizing.w === "FILL") try { frame.layoutSizingHorizontal = "FILL"; } catch { /* parent not auto-layout */ }
  if (sizing.w === "HUG") try { frame.layoutSizingHorizontal = "HUG"; } catch {}
  if (sizing.h === "FILL") try { frame.layoutSizingVertical = "FILL"; } catch {}
  if (sizing.h === "HUG") try { frame.layoutSizingVertical = "HUG"; } catch {}
}

// ─── instance ────────────────────────────────────────────────────────────

async function buildInstance(recipe: InstanceRecipe, warnings: string[]): Promise<InstanceNode> {
  let comp;
  try {
    comp = await figma.importComponentByKeyAsync(recipe.key);
  } catch (err) {
    warnings.push(
      `importComponentByKeyAsync failed for ${recipe.key}: ${String(err)}. ` +
        `If this is a COMPONENT_SET key, use its defaultVariantKey instead.`,
    );
    // Fall back to a stub so the overall recipe doesn't blow up.
    const stub = figma.createFrame();
    stub.name = recipe.name ?? `[missing component ${recipe.key.slice(0, 8)}]`;
    stub.resize(120, 40);
    stub.fills = [{ type: "SOLID", color: hexToRgb("#fff4f4") }];
    return stub as unknown as InstanceNode;
  }
  const inst = comp.createInstance();
  if (recipe.name) inst.name = recipe.name;

  if (recipe.variant && Object.keys(recipe.variant).length) {
    try {
      inst.setProperties(recipe.variant);
    } catch (err) {
      warnings.push(`setProperties failed on ${recipe.name ?? recipe.key}: ${String(err)}`);
    }
  }

  if (recipe.overrides && Object.keys(recipe.overrides).length) {
    try {
      inst.setProperties(recipe.overrides as Record<string, string | boolean>);
    } catch (err) {
      warnings.push(`overrides failed on ${recipe.name ?? recipe.key}: ${String(err)}`);
    }
  }

  if (recipe.textOverrides && Object.keys(recipe.textOverrides).length) {
    await applyInstanceTextOverrides(inst, recipe.textOverrides, warnings);
  }

  return inst;
}

async function applyInstanceTextOverrides(
  inst: InstanceNode,
  overrides: Record<string, string>,
  warnings: string[],
): Promise<void> {
  const targets: TextNode[] = [];
  function collect(n: BaseNode): void {
    if (n.type === "TEXT") targets.push(n);
    if ("children" in n) for (const c of n.children) collect(c);
  }
  collect(inst);

  for (const t of targets) {
    const newChars = overrides[t.name];
    if (newChars === undefined) continue;
    try {
      const fontName = t.fontName;
      if (typeof fontName !== "symbol") await figma.loadFontAsync(fontName);
      t.characters = newChars;
    } catch (err) {
      warnings.push(`text override for "${t.name}" failed: ${String(err)}`);
    }
  }
}

// ─── text ────────────────────────────────────────────────────────────────

async function buildText(recipe: TextRecipe, warnings: string[]): Promise<TextNode> {
  const t = figma.createText();
  if (recipe.name) t.name = recipe.name;

  // Style first — sets font + size. If style import fails, fall back to Inter.
  if (recipe.styleId) {
    try {
      await figma.loadFontAsync({ family: "Inter", style: "Regular" });
      t.fontName = { family: "Inter", style: "Regular" };
      await figma.importStyleByKeyAsync(recipe.styleId.replace(/^S:/, "").split(",")[0]);
      t.textStyleId = recipe.styleId;
    } catch (err) {
      warnings.push(`text style ${recipe.styleId} not applied: ${String(err)}`);
    }
  } else {
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
    t.fontName = { family: "Inter", style: "Regular" };
  }

  t.characters = recipe.chars;

  if (recipe.align) t.textAlignHorizontal = recipe.align;

  if (recipe.colorToken) {
    const tokenName = parseTokenRef(recipe.colorToken);
    if (tokenName) {
      const v = await getVariableByTokenName(tokenName);
      if (v) {
        const basePaint: SolidPaint = { type: "SOLID", color: { r: 0, g: 0, b: 0 } };
        const bound = figma.variables.setBoundVariableForPaint(basePaint, "color", v);
        t.fills = [bound];
      } else {
        warnings.push(`unknown text-color token: ${tokenName}`);
      }
    } else if (recipe.colorToken.startsWith("#")) {
      t.fills = [{ type: "SOLID", color: hexToRgb(recipe.colorToken) }];
    } else {
      warnings.push(`unparseable text color: ${recipe.colorToken}`);
    }
  }

  return t;
}

// ─── helpers ─────────────────────────────────────────────────────────────

async function applyFill(frame: FrameNode, value: string, warnings: string[]): Promise<void> {
  const tokenName = parseTokenRef(value);
  if (tokenName) {
    const v = await getVariableByTokenName(tokenName);
    if (v) {
      // Start with a placeholder SOLID, then bind. Figma reads the actual
      // RGBA from the variable's resolved value per-mode.
      const basePaint: SolidPaint = { type: "SOLID", color: { r: 0, g: 0, b: 0 } };
      const bound = figma.variables.setBoundVariableForPaint(basePaint, "color", v);
      frame.fills = [bound];
      return;
    }
    warnings.push(`unknown token in fill: ${tokenName}`);
    frame.fills = [];
    return;
  }
  if (value.startsWith("#")) {
    frame.fills = [{ type: "SOLID", color: hexToRgb(value) }];
    return;
  }
  warnings.push(`unparseable fill: ${value}`);
  frame.fills = [];
}

function hexToRgb(hex: string): RGB {
  const m = hex.replace("#", "");
  const n = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const num = parseInt(n, 16);
  return {
    r: ((num >> 16) & 0xff) / 255,
    g: ((num >> 8) & 0xff) / 255,
    b: (num & 0xff) / 255,
  };
}

function countNodes(n: RecipeNode): number {
  if (n.kind === "frame") {
    return 1 + n.children.reduce((acc, c) => acc + countNodes(c), 0);
  }
  return 1;
}

