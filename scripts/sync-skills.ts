/**
 * sync-skills.ts
 *
 * Phase 6.11.
 *
 * Pulls the Token Cheat Sheet and Non-Negotiable Design Rules sections
 * out of `Hydrogen-Designs/CLAUDE.md` and splices them into
 * `Poseidon/skills/hydrogen-ds/SKILL.md` between two markers so the
 * skill stays in sync with the canonical source-of-truth doc.
 *
 * Idempotent. Re-run whenever the upstream docs change. Safe even when the
 * markers aren't present yet (we'll insert them).
 *
 * Future: add the same splice for `accessibility/SKILL.md` from
 * `docs/design-system/06-accessibility.md` once that doc grows.
 */

import { readFile, writeFile, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");                // Hydrogen-Designs/
const CLAUDE_MD = resolve(ROOT, "CLAUDE.md");
const SKILL_PATH = resolve(__dirname, "..", "skills", "hydrogen-ds", "SKILL.md");

const TOKEN_MARKER_START = "<!-- BEGIN auto-sync: most-used-tokens (sync-skills.ts) -->";
const TOKEN_MARKER_END = "<!-- END auto-sync: most-used-tokens -->";
const RULES_MARKER_START = "<!-- BEGIN auto-sync: non-negotiable-rules (sync-skills.ts) -->";
const RULES_MARKER_END = "<!-- END auto-sync: non-negotiable-rules -->";

async function ensureExists(path: string, label: string): Promise<void> {
  try {
    const s = await stat(path);
    if (!s.isFile()) throw new Error("not a file");
  } catch (err) {
    throw new Error(`${label} missing: ${path} (${(err as Error).message})`);
  }
}

function extractSection(doc: string, headingRegex: RegExp): string | null {
  const match = doc.match(headingRegex);
  if (!match) return null;
  const start = match.index! + match[0].length;
  // Find the next heading of the same or higher level.
  const tail = doc.slice(start);
  const next = tail.match(/\n#{1,3}\s/);
  return (next ? tail.slice(0, next.index!) : tail).trim();
}

/** Splices `replacement` between START/END markers, inserting them if absent. */
function spliceBlock(
  source: string,
  start: string,
  end: string,
  replacement: string,
  appendIfAbsent: boolean,
): string {
  const startIdx = source.indexOf(start);
  const endIdx = source.indexOf(end);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return source.slice(0, startIdx + start.length) + "\n" + replacement + "\n" + source.slice(endIdx);
  }
  if (!appendIfAbsent) return source;
  // No markers yet — append at the end.
  return `${source.trimEnd()}\n\n${start}\n${replacement}\n${end}\n`;
}

async function main(): Promise<void> {
  await ensureExists(CLAUDE_MD, "Hydrogen-Designs/CLAUDE.md");
  await ensureExists(SKILL_PATH, "hydrogen-ds/SKILL.md");

  const [claudeMd, skill] = await Promise.all([
    readFile(CLAUDE_MD, "utf8"),
    readFile(SKILL_PATH, "utf8"),
  ]);

  const tokensSection = extractSection(claudeMd, /(^|\n)##\s+Token Cheat Sheet.*?\n/i);
  if (!tokensSection) {
    throw new Error("Could not find 'Token Cheat Sheet' section in CLAUDE.md");
  }

  const rulesSection = extractSection(
    claudeMd,
    /(^|\n)##\s+Non-Negotiable Design Rules\s*\n/i,
  );
  if (!rulesSection) {
    throw new Error("Could not find 'Non-Negotiable Design Rules' section in CLAUDE.md");
  }

  let next = skill;
  next = spliceBlock(next, RULES_MARKER_START, RULES_MARKER_END, rulesSection, true);
  next = spliceBlock(next, TOKEN_MARKER_START, TOKEN_MARKER_END, tokensSection, true);

  if (next === skill) {
    console.log("[sync-skills] no changes");
    return;
  }
  await writeFile(SKILL_PATH, next);
  console.log(`[sync-skills] updated ${SKILL_PATH}`);
}

main().catch((err) => {
  console.error("[sync-skills]", err.message);
  process.exit(1);
});
