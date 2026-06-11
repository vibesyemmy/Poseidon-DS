/**
 * Poseidon Bridge — entry point.
 *
 * Runs locally as `pnpm dev` (or `pnpm start`). The Figma plugin talks to this
 * process over `http://localhost:9334`. Responsibilities:
 *
 *  - Detect whether Claude Code is installed and authed (claudeCode + health).
 *  - Stream chat completions from Anthropic via Agent SDK using the user's
 *    Claude Code credentials.
 *  - Load bundled + user skills from the filesystem.
 *  - Maintain ref-counted plugin sessions; exit when idle.
 */

import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { getHealth } from "./health.ts";
import { handleChat } from "./chat.ts";
import { loadDefaultSkills, watchSkills, type Skill } from "./skills.ts";
import { SessionManager, configFromEnv } from "./session.ts";
import { getRouter, type SandboxToolResult } from "./toolRouter.ts";

const PORT = Number(process.env.POSEIDON_PORT ?? 9334);

// Bundled skills directory is one level above the bridge package.
const BUNDLED_SKILLS_DIR = resolve(import.meta.dirname, "..", "..", "skills");

// ─── App init ────────────────────────────────────────────────────────────

const app = new Hono();

app.use(
  "/*",
  cors({
    origin: ["https://www.figma.com", "null"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    maxAge: 600,
  }),
);

// Load skills once at boot + watch for changes so editing a SKILL.md
// takes effect on the next chat message without a server restart.
const INCLUDE_CLAUDE_SKILLS = process.env.POSEIDON_INCLUDE_CLAUDE_SKILLS === "1";

let loadedSkills: Skill[] = [];
let skillWarnings: string[] = [];

async function reloadSkills(): Promise<void> {
  const res = await loadDefaultSkills(BUNDLED_SKILLS_DIR, {
    includeClaudeSkills: INCLUDE_CLAUDE_SKILLS,
  });
  loadedSkills = res.skills;
  skillWarnings = res.warnings;
  console.log(`[poseidon] loaded ${loadedSkills.length} skill(s)`);
  if (skillWarnings.length) {
    for (const w of skillWarnings) console.warn(`[poseidon] skill warning: ${w}`);
  }
}

await reloadSkills();

const stopWatchingSkills = watchSkills(
  BUNDLED_SKILLS_DIR,
  { includeClaudeSkills: INCLUDE_CLAUDE_SKILLS },
  () => {
    console.log("[poseidon] skill files changed; reloading…");
    void reloadSkills();
  },
);

// Session manager — onIdleShutdown triggers graceful exit.
const sessions = new SessionManager(
  configFromEnv((reason) => {
    console.log(`[poseidon] idle shutdown: ${reason}`);
    shutdown("idle");
  }),
);
sessions.start();

// ─── Liveness ────────────────────────────────────────────────────────────

app.get("/ping", (c) =>
  c.json({
    ok: true,
    name: "poseidon-bridge",
    version: "0.1.0",
    uptimeMs: sessions.uptimeMs(),
    activeSessions: sessions.activeCount(),
  }),
);

// ─── /health ─────────────────────────────────────────────────────────────

app.get("/health", async (c) => {
  const skipPing = c.req.query("skipPing") === "1";
  const report = await getHealth({ skipPing });
  return c.json(report);
});

// ─── /skills ─────────────────────────────────────────────────────────────

app.get("/skills", (c) =>
  c.json({
    count: loadedSkills.length,
    warnings: skillWarnings,
    skills: loadedSkills.map((s) => ({
      name: s.name,
      description: s.description,
      whenToUse: s.whenToUse ?? null,
      origin: s.origin,
      bodyChars: s.body.length,
    })),
  }),
);

// ─── Session lifecycle ──────────────────────────────────────────────────

app.post("/session/start", async (c) => {
  let label: string | undefined;
  try {
    const body = (await c.req.json()) as { label?: string } | undefined;
    label = body?.label;
  } catch {
    // No body is fine.
  }
  const info = sessions.startSession(label);
  return c.json({ ok: true, session: info });
});

app.post("/session/heartbeat", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { id?: string };
  if (!body.id) return c.json({ ok: false, reason: "missing-id" }, 400);
  const res = sessions.heartbeat(body.id);
  if (!res.ok) return c.json(res, 404);
  return c.json({ ok: true, session: res.info });
});

app.post("/session/end", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { id?: string };
  if (!body.id) return c.json({ ok: false, reason: "missing-id" }, 400);
  const res = sessions.endSession(body.id);
  if (!res.ok) return c.json(res, 404);
  return c.json({ ok: true });
});

// ─── Direct data fetches (used by plugin UI shortcut chips) ─────────────

import { readFile } from "node:fs/promises";

import { listAll as listAllTemplates } from "./templates.ts";

const DATA_DIR = resolve(import.meta.dirname, "..", "..", "data");

app.get("/templates", async (c) => {
  const all = await listAllTemplates();
  return c.json({
    count: all.length,
    templates: all.map((t) => ({
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
});
app.get("/components", async (c) => {
  const raw = await readFile(resolve(DATA_DIR, "components.json"), "utf8");
  return c.json(JSON.parse(raw));
});

// ─── /chat ───────────────────────────────────────────────────────────────

app.post("/chat", (c) =>
  handleChat(c, {
    skills: loadedSkills,
    touchSession: (id) => sessions.heartbeat(id),
  }),
);

// ─── /audit ─────────────────────────────────────────────────────────────
//
// STEP 3 — plugin POSTs TemplateAuditEntry rows here. Bridge appends to
// ~/.poseidon/audit.jsonl (or POSEIDON_AUDIT_PATH override).
app.post("/audit", async (c) => {
  const entry = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!entry || typeof entry !== "object") {
    return c.json({ ok: false, reason: "invalid-entry" }, 400);
  }
  try {
    const { appendFile, mkdir } = await import("node:fs/promises");
    const { homedir } = await import("node:os");
    const { dirname, join } = await import("node:path");
    const auditPath =
      process.env.POSEIDON_AUDIT_PATH ||
      join(homedir(), ".poseidon", "audit.jsonl");
    await mkdir(dirname(auditPath), { recursive: true });
    await appendFile(
      auditPath,
      JSON.stringify({ kind: "ui_audit", ...entry }) + "\n",
      "utf8",
    );
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ ok: false, reason: (err as Error).message }, 500);
  }
});

// ─── /tool-response ─────────────────────────────────────────────────────
//
// Plugin sandbox finished executing a tool. Pass the result back to the
// pending tool router so the SDK's tool handler can resolve.
app.post("/tool-response", async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { streamId?: string; requestId?: string; result?: SandboxToolResult }
    | null;
  if (!body?.streamId || !body.requestId || !body.result) {
    return c.json({ ok: false, reason: "missing-fields" }, 400);
  }
  const router = getRouter(body.streamId);
  if (!router) return c.json({ ok: false, reason: "stream-not-found" }, 404);
  const resolved = router.resolve(body.requestId, body.result);
  if (!resolved) return c.json({ ok: false, reason: "request-not-pending" }, 404);
  return c.json({ ok: true });
});

// ─── Boilerplate ─────────────────────────────────────────────────────────

app.notFound((c) => c.json({ error: "not_found", path: c.req.path }, 404));

app.onError((err, c) => {
  console.error("[poseidon] unhandled error", err);
  return c.json({ error: "internal_error", message: err.message }, 500);
});

const server = serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" }, (info) => {
  console.log(`[poseidon] bridge listening on http://127.0.0.1:${info.port}`);
});

function shutdown(reason: string) {
  console.log(`[poseidon] shutting down (${reason})`);
  sessions.stop();
  stopWatchingSkills();
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
