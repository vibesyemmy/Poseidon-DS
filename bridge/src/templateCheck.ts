/**
 * STEP 1 — preamble validator + audit log for template-first enforcement.
 *
 * See ENFORCEMENT.md for the full defense-in-depth plan.
 *
 * SCOPE (STEP 1): warn-only observability.
 *   - Logs every screen-creation tool call to ~/.poseidon/audit.jsonl with
 *     preamble status, intent, variant, tool args, and a per-turn telemetry
 *     bundle.
 *   - DOES NOT block calls. STEP 2 introduces the deterministic tool-gate
 *     (templates.suggest → templates.choose → screen.from_template).
 *
 * Config:
 *   - POSEIDON_AUDIT_PATH env var overrides the default audit file path.
 */

import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Tools that materialize structure on the canvas and therefore require a preamble. */
export const SCREEN_CREATION_TOOLS = new Set([
  "insert_template",
  "insert_component",
  "emit_recipe",
  "modify_node",
]);

/**
 * Strict regex: must be at the start of a line; tolerates surrounding
 * whitespace and any visible chars in the intent.
 */
const PREAMBLE_RE = /^\s*Template check:\s+(.+?)\s+->\s+(\S+)\s*$/m;

export interface PreambleMatch {
  intent: string;
  variantKey: string;
}

export function parsePreamble(text: string): PreambleMatch | null {
  if (!text) return null;
  const m = text.match(PREAMBLE_RE);
  if (!m) return null;
  return { intent: m[1].trim(), variantKey: m[2].trim() };
}

/** True if the tool name (already stripped of `mcp__poseidon__` prefix) materializes screen structure. */
export function isScreenCreationTool(toolName: string): boolean {
  return SCREEN_CREATION_TOOLS.has(toolName);
}

/** Strip the MCP namespace prefix so we can compare against SCREEN_CREATION_TOOLS. */
export function stripMcpPrefix(toolName: string): string {
  const idx = toolName.lastIndexOf("__");
  return idx >= 0 ? toolName.slice(idx + 2) : toolName;
}

export interface AuditEntry {
  timestamp: string;
  sessionId?: string;
  streamId: string;
  toolName: string;
  preamblePresent: boolean;
  preambleIntent?: string;
  preambleVariantKey?: string;
  templatesSuggestCalled: boolean;
  /** True when variantKey === "none" → designer must have been prompted. */
  escapeUsed: boolean;
  /** True when a screen tool fired without a preamble. */
  silentComposeAttempted: boolean;
  /** STEP 2 will set this when the bridge auto-injects a templates.suggest call. */
  forcedInjectionFired: boolean;
  toolArgsSummary: string;
}

const AUDIT_PATH =
  process.env.POSEIDON_AUDIT_PATH ||
  join(homedir(), ".poseidon", "audit.jsonl");

let auditDirEnsured = false;

async function ensureAuditDir(): Promise<void> {
  if (auditDirEnsured) return;
  await mkdir(dirname(AUDIT_PATH), { recursive: true });
  auditDirEnsured = true;
}

export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    await ensureAuditDir();
    await appendFile(AUDIT_PATH, JSON.stringify(entry) + "\n", "utf8");
  } catch (err) {
    console.warn("[poseidon] audit log failed:", (err as Error).message);
  }
}

export function summarizeToolArgs(input: unknown): string {
  try {
    const s = JSON.stringify(input);
    return s.length > 200 ? s.slice(0, 197) + "..." : s;
  } catch {
    return "<unserializable>";
  }
}

/** Path for inspection in tests / debug. */
export function getAuditPath(): string {
  return AUDIT_PATH;
}
