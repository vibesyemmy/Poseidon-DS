/**
 * Skill loader.
 *
 * Walks each configured skill root, reads every `<root>/<skill>/SKILL.md`,
 * parses its YAML frontmatter, and returns a flat list of `Skill` records
 * the rest of the bridge can inject into the SDK system prompt.
 *
 * Phase 1.8 — walks dirs and parses frontmatter
 * Phase 1.9 — register with SDK (Phase 1 stub: append to systemPrompt;
 *             real SDK plugin integration lands in Phase 6)
 * Phase 1.10 — bundled `hydrogen-ds` skill ships in `Poseidon/skills/`
 *
 * Frontmatter format (mirrors Claude Code's SKILL.md convention):
 *
 *   ---
 *   name: hydrogen-ds
 *   description: One-line trigger description Claude uses to decide when to invoke.
 *   when-to-use: Optional extra hint.
 *   ---
 *
 *   <markdown body>
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { watch as fsWatch } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface Skill {
  /** Canonical id, e.g. "hydrogen-ds". Comes from frontmatter `name`. */
  name: string;
  /** Trigger description Claude uses to decide when to read the body. */
  description: string;
  /** Optional `when-to-use` hint. */
  whenToUse?: string;
  /** Source directory the SKILL.md was found in. */
  sourceDir: string;
  /** Absolute path to the SKILL.md file. */
  filePath: string;
  /** Markdown body (everything after the closing `---`). */
  body: string;
  /** Which root this skill came from — affects precedence on name clash. */
  origin: "bundled" | "user-claude" | "user-poseidon";
}

export interface SkillLoadResult {
  skills: Skill[];
  /** Issues encountered (skipped skills, parse errors). Non-fatal. */
  warnings: string[];
}

/**
 * Order matters: earlier roots win on name clash. Bundled first because the
 * team-vetted version of a skill should beat a designer's local override of
 * the same name (override should be a *different* name).
 *
 * `~/.claude/skills/` is OFF by default because most users have unrelated
 * Claude Code skills there (image generators, video tools, other DS-specific
 * skills) that bloat the prompt and aren't applicable to Poseidon. Set
 * `POSEIDON_INCLUDE_CLAUDE_SKILLS=1` to opt in.
 *
 * `~/.poseidon/skills/` is ON by default — that directory is Poseidon-only
 * by convention, so anything a user drops there is intentional.
 */
export function defaultSkillRoots(
  bundledRoot: string,
  options: { includeClaudeSkills?: boolean } = {},
): Array<{ path: string; origin: Skill["origin"] }> {
  const roots: Array<{ path: string; origin: Skill["origin"] }> = [
    { path: bundledRoot, origin: "bundled" },
  ];
  if (options.includeClaudeSkills) {
    roots.push({ path: join(homedir(), ".claude", "skills"), origin: "user-claude" });
  }
  roots.push({ path: join(homedir(), ".poseidon", "skills"), origin: "user-poseidon" });
  return roots;
}

export async function loadSkills(
  roots: Array<{ path: string; origin: Skill["origin"] }>,
): Promise<SkillLoadResult> {
  const warnings: string[] = [];
  const byName = new Map<string, Skill>();

  for (const root of roots) {
    let exists = false;
    try {
      const s = await stat(root.path);
      exists = s.isDirectory();
    } catch {
      // Missing root is fine — designers may not have ~/.poseidon/skills yet.
      continue;
    }
    if (!exists) continue;

    let entries: string[];
    try {
      entries = await readdir(root.path);
    } catch (err) {
      warnings.push(`could not read skill root ${root.path}: ${(err as Error).message}`);
      continue;
    }

    for (const entry of entries) {
      const skillDir = join(root.path, entry);
      const skillFile = join(skillDir, "SKILL.md");

      let body: string;
      try {
        const s = await stat(skillDir);
        if (!s.isDirectory()) continue;
        body = await readFile(skillFile, "utf8");
      } catch {
        continue; // No SKILL.md here — not a skill dir, skip silently.
      }

      const parsed = parseSkillMarkdown(body);
      if (!parsed.ok) {
        warnings.push(`${skillFile}: ${parsed.error}`);
        continue;
      }

      const skill: Skill = {
        name: parsed.frontmatter.name,
        description: parsed.frontmatter.description,
        whenToUse: parsed.frontmatter["when-to-use"],
        sourceDir: skillDir,
        filePath: skillFile,
        body: parsed.body,
        origin: root.origin,
      };

      // First write wins (bundled beats user override of same name).
      if (!byName.has(skill.name)) {
        byName.set(skill.name, skill);
      } else {
        warnings.push(
          `skill name '${skill.name}' duplicated — kept ${byName.get(skill.name)!.origin}, ignored ${root.origin} at ${skillFile}`,
        );
      }
    }
  }

  return { skills: [...byName.values()], warnings };
}

// ─────────────────────────────────────────────────────────────────────────
// Frontmatter parser — tiny, dependency-free.
// ─────────────────────────────────────────────────────────────────────────

interface ParsedSkill {
  frontmatter: { name: string; description: string; [key: string]: string };
  body: string;
}
type ParseResult =
  | { ok: true; frontmatter: ParsedSkill["frontmatter"]; body: string }
  | { ok: false; error: string };

export function parseSkillMarkdown(raw: string): ParseResult {
  // Accept LF or CRLF; tolerate UTF-8 BOM.
  const clean = raw.replace(/^﻿/, "");

  const fmMatch = clean.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fmMatch) {
    return { ok: false, error: "missing YAML frontmatter (expected `---` block at top of file)" };
  }

  const yaml = fmMatch[1];
  const body = (fmMatch[2] ?? "").trimStart();

  // Naive line-by-line key:value parse. We only need string values; arrays /
  // nested objects aren't part of the skill spec.
  const frontmatter: Record<string, string> = {};
  for (const lineRaw of yaml.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx <= 0) {
      return { ok: false, error: `invalid frontmatter line: ${lineRaw}` };
    }
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    // Strip simple quoting.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    frontmatter[key] = value;
  }

  if (!frontmatter.name) return { ok: false, error: "frontmatter is missing `name`" };
  if (!frontmatter.description) return { ok: false, error: "frontmatter is missing `description`" };

  return {
    ok: true,
    frontmatter: frontmatter as ParsedSkill["frontmatter"],
    body,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Phase 1.9 stub — compose loaded skills into a system-prompt append block.
//
// Real plugin-based registration (so Claude can lazy-load skills on demand)
// lands in Phase 6. For now the bundled `hydrogen-ds` stub is small enough
// to inline.
// ─────────────────────────────────────────────────────────────────────────

export function buildSkillSystemPrompt(skills: Skill[]): string {
  if (skills.length === 0) return "";
  const blocks = skills.map((s) => {
    const trigger = s.whenToUse ? `\n*When to use:* ${s.whenToUse}` : "";
    return `## Skill: ${s.name}\n${s.description}${trigger}\n\n${s.body}`;
  });
  return [
    "# Available skills",
    "The following skills are pre-loaded for this session. Treat them as authoritative reference material.",
    "",
    ...blocks,
  ].join("\n\n");
}

/**
 * Convenience: load + compose in one call, using the canonical root layout.
 */
export async function loadDefaultSkills(
  bundledRoot: string,
  options: { includeClaudeSkills?: boolean } = {},
): Promise<SkillLoadResult & { systemPrompt: string }> {
  const abs = resolve(bundledRoot);
  const res = await loadSkills(defaultSkillRoots(abs, options));
  return { ...res, systemPrompt: buildSkillSystemPrompt(res.skills) };
}

/**
 * Watch every loaded skill's `SKILL.md` plus the skill roots themselves
 * for changes. Calls `onChange` (debounced) so the server can re-`loadSkills`
 * without restarting.
 */
export function watchSkills(
  bundledRoot: string,
  options: { includeClaudeSkills?: boolean },
  onChange: () => void,
): () => void {
  const abs = resolve(bundledRoot);
  const roots = defaultSkillRoots(abs, options);
  const watchers: Array<{ close(): void }> = [];

  let debounceTimer: NodeJS.Timeout | null = null;
  const debouncedFire = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      onChange();
    }, 300);
  };

  for (const root of roots) {
    try {
      // Recursive watch lets us pick up edits to any SKILL.md inside the
      // root, plus new subdirs being added. macOS + Linux support this.
      const w = fsWatch(root.path, { recursive: true }, (_evt, filename) => {
        if (!filename) return;
        if (filename.endsWith("SKILL.md") || filename.endsWith(".md")) {
          debouncedFire();
        }
      });
      watchers.push(w);
    } catch {
      // Root dir may not exist (e.g. ~/.poseidon/skills) — skip silently.
    }
  }

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    for (const w of watchers) w.close();
  };
}
