/**
 * Recipe schema — shared by:
 *   - Sandbox: `instantiate.ts` walks recipes → figma nodes
 *   - Sandbox: `capture.ts` walks selection → recipes (Phase 7)
 *   - Bridge:  serializes/deserializes for AI tool calls
 *   - Tests:   bundled + repo + user templates all conform
 *
 * Keep this declarative + serializable. No functions, no refs to figma.*.
 */

// ─── Coordinates + sizing ────────────────────────────────────────────────

export interface Position {
  x: number;
  y: number;
}

export type Dim = "FILL" | "HUG" | number;

export interface Sizing {
  w?: Dim;
  h?: Dim;
}

// ─── Node union ──────────────────────────────────────────────────────────

export type Node = FrameNode | InstanceNode | TextNode | StubNode;

/** Padding can be a single number (all sides) or a per-edge map. */
export type Padding = number | { top?: number; right?: number; bottom?: number; left?: number };

export interface FrameNode {
  kind: "frame";
  name?: string;
  /** Position relative to parent. Only meaningful when the parent's layout is `"NONE"`. */
  position?: Position;
  layout?: "VERTICAL" | "HORIZONTAL" | "NONE";
  padding?: Padding;
  /** Gap between auto-layout children. */
  gap?: number;
  sizing?: Sizing;
  /** Token reference (e.g. "color/special/background/page-bg") or raw hex (#rrggbb). */
  fill?: string;
  /** Token reference (e.g. "radius/regular") or raw px. */
  cornerRadius?: string | number;
  align?: {
    primary?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
    counter?: "MIN" | "CENTER" | "MAX";
  };
  children: Node[];
}

export interface InstanceNode {
  kind: "instance";
  /** Position relative to parent. Only meaningful when the parent's layout is `"NONE"`. */
  position?: Position;
  /** DS component team-library key (matches `components.json[].key`). */
  key: string;
  /** Variant property overrides — `{ "Type": "Primary", "Size": "Medium" }`. */
  variant?: Record<string, string>;
  /** Generic instance prop overrides (text props, swap props, etc.). */
  overrides?: Record<string, unknown>;
  /** TEXT layer-name → new chars. Walked depth-first across the instance. */
  textOverrides?: Record<string, string>;
  name?: string;
}

export interface TextNode {
  kind: "text";
  /** Position relative to parent. Only meaningful when the parent's layout is `"NONE"`. */
  position?: Position;
  /** DS text style id, e.g. "S:616b6bd024901bde1e156497e9f1e7f8424d2dbd,148:8". */
  styleId?: string;
  /** Token reference (e.g. "color/text/01") or raw hex. */
  colorToken?: string;
  chars: string;
  align?: "LEFT" | "CENTER" | "RIGHT";
  sizing?: Sizing;
  name?: string;
}

/**
 * Placeholder node used during Phase 4 before the full instantiate walker
 * lands. Renders as a labeled rectangle so we can prove the end-to-end
 * tool roundtrip without committing to full recipe extraction yet.
 */
export interface StubNode {
  kind: "stub";
  label: string;
  width: number;
  height: number;
  /** Background hex; defaults to #f5f5f7. */
  fill?: string;
  name?: string;
}

// ─── Recipe wrapper ──────────────────────────────────────────────────────

export interface RecipeMeta {
  name?: string;
  category?: string;
  description?: string;
}

export interface Recipe {
  root: Node;
  meta?: RecipeMeta;
}

// ─── Type guards (handy for the walker switch) ───────────────────────────

export function isFrame(n: Node): n is FrameNode {
  return n.kind === "frame";
}
export function isInstance(n: Node): n is InstanceNode {
  return n.kind === "instance";
}
export function isText(n: Node): n is TextNode {
  return n.kind === "text";
}
export function isStub(n: Node): n is StubNode {
  return n.kind === "stub";
}
