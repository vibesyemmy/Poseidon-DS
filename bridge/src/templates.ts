/**
 * Template storage — three roots:
 *
 *   bundled  Poseidon/data/seed-templates.json        (read-only, repo-tracked metadata)
 *   repo     Poseidon/templates/*.json                (team-blessed full recipes, repo-tracked)
 *   user     ~/.poseidon/templates/*.json             (designer-saved, machine-local)
 *
 * `listAll` returns a merged + de-duped list with `origin` tags. `saveUser`
 * writes a single template file under `~/.poseidon/templates/`. Slug
 * collisions: repo > user > bundled.
 */

import { mkdir, readFile, readdir, writeFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "..", "..", "data");
const REPO_DIR = resolve(__dirname, "..", "..", "templates");
const USER_DIR = join(homedir(), ".poseidon", "templates");

export type TemplateOrigin = "bundled" | "repo" | "user";

export interface TemplateMeta {
  slug: string;
  name: string;
  category: string;
  description?: string;
  tags?: string[];
  width: number;
  height: number;
  origin: TemplateOrigin;
}
export interface TemplateRecord extends TemplateMeta {
  /** Recipe JSON, present for repo + user templates; null for bundled stubs (Phase 4 metadata only). */
  recipe: unknown | null;
  filePath?: string;
  savedAt?: string;
}

interface SeedFile {
  templates: Array<Omit<TemplateMeta, "origin">>;
}

async function readBundled(): Promise<TemplateRecord[]> {
  try {
    const raw = await readFile(resolve(DATA_DIR, "seed-templates.json"), "utf8");
    const parsed = JSON.parse(raw) as SeedFile;
    return parsed.templates.map((t) => ({ ...t, origin: "bundled" as const, recipe: null }));
  } catch {
    return [];
  }
}

async function readDir(dir: string, origin: "repo" | "user"): Promise<TemplateRecord[]> {
  try {
    const s = await stat(dir);
    if (!s.isDirectory()) return [];
  } catch {
    return [];
  }
  const out: TemplateRecord[] = [];
  for (const entry of await readdir(dir)) {
    if (!entry.endsWith(".json")) continue;
    const filePath = join(dir, entry);
    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as TemplateRecord;
      out.push({ ...parsed, origin, filePath });
    } catch {
      // Skip malformed files silently.
    }
  }
  return out;
}

export async function listAll(): Promise<TemplateRecord[]> {
  // Order: bundled first so repo/user can OVERRIDE on slug match.
  const merged = new Map<string, TemplateRecord>();
  for (const t of await readBundled()) merged.set(t.slug, t);
  for (const t of await readDir(USER_DIR, "user")) merged.set(t.slug, t);
  for (const t of await readDir(REPO_DIR, "repo")) merged.set(t.slug, t);
  return [...merged.values()];
}

export async function saveUser(record: Omit<TemplateRecord, "origin" | "filePath" | "savedAt">): Promise<TemplateRecord> {
  await mkdir(USER_DIR, { recursive: true });
  const filePath = join(USER_DIR, `${record.slug}.json`);
  const full: TemplateRecord = {
    ...record,
    origin: "user",
    filePath,
    savedAt: new Date().toISOString(),
  };
  await writeFile(filePath, JSON.stringify(full, null, 2));
  return full;
}

export async function getBySlug(slug: string): Promise<TemplateRecord | null> {
  const all = await listAll();
  return all.find((t) => t.slug === slug) ?? null;
}
