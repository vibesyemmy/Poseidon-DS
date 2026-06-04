/**
 * /chat SSE handler.
 *
 * Streams Claude Agent SDK messages back to the plugin. Tool round-trip
 * goes through ToolRouter (see toolRouter.ts).
 *
 * SSE event types (Phase 4):
 *
 *   event: meta
 *   data: { streamId, model, startedAt }
 *
 *   event: message
 *   data: <SDKMessage>          // every SDK event (assistant, tool_use, result, ...)
 *
 *   event: tool_request
 *   data: { requestId, tool, input }   // bridge wants plugin to execute
 *
 *   event: done
 *   data: { durationMs, costUsd }
 *
 *   event: error
 *   data: { message }
 */

import { streamSSE } from "hono/streaming";
import type { Context } from "hono";

import { defaultQueryOptions, importSdk } from "./agentSdk.ts";
import { buildSkillSystemPrompt, type Skill } from "./skills.ts";
import { buildPoseidonMcpServer } from "./tools.ts";
import { ToolRouter, registerRouter, unregisterRouter } from "./toolRouter.ts";

export interface ChatRequest {
  prompt: string;
  sessionId?: string;
  resume?: string;
  model?: string;
}

export interface ChatDeps {
  skills: Skill[];
  touchSession?: (sessionId: string) => void;
}

const SYSTEM_PROMPT_BASE = [
  "You are Poseidon, an AI design copilot for the Hydrogen Design System.",
  "",
  "You help designers compose screens by calling tools that drop DS components and templates onto their Figma canvas. You have two tiers of tools:",
  "",
  "Tier 1 — DECLARATIVE (prefer these):",
  "  list_templates, list_components, get_styles, get_variables, get_canvas_state, read_selection,",
  "  insert_template, insert_component, emit_recipe, modify_node, swap_theme, swap_density,",
  "  capture_screenshot.",
  "  Validated inputs, auditable, undo-grouped per turn.",
  "",
  "Tier 2 — ESCAPE HATCH:",
  "  figma_execute — arbitrary JS with the `figma` global in scope.",
  "  Use ONLY when no declarative tool covers the task (strokes, effects, layout grids, custom traversals).",
  "  Always `await figma.loadFontAsync(node.fontName)` before setting `characters`.",
  "  Always `await figma.loadAllPagesAsync()` before walking root.",
  "",
  "Workflow guidance:",
  "  1. When a designer asks for a screen, call list_templates first.",
  "  2. Pick the best match by category and name, then insert_template with that slug.",
  "  3. For single components, use list_components → insert_component.",
  "  4. For bespoke layouts, use emit_recipe (frame/instance/text tree).",
  "  5. To tweak existing nodes: modify_node.",
  "  6. MANDATORY self-review: after ANY insert_template / insert_component / emit_recipe / modify_node call, immediately capture_screenshot the result. Then INSPECT it: are fills present, are children positioned correctly, does the layout match the request? If something is wrong (missing fills, overlapping nodes, wrong widths/heights, stub-looking gray boxes), iterate via modify_node or emit_recipe before declaring done. Don't ship visibly broken UI.",
  "  7. Be concise. Don't restate the user's request. One short line per turn summarizing what changed.",
  "  8. NEVER paste base64 data URLs back into your text response — the Poseidon UI already renders screenshots from the tool result. Describe in words what you observed in the screenshot, no `data:image/...` blobs.",
  "  9. Use ask_user SPARINGLY — only when proceeding would require a guess on a load-bearing decision the designer hasn't already implied. Most requests should be answered directly.",
  "",
  "Composing with tokens:",
  "  - For fills and text colors in emit_recipe, USE token references: `fill: \"var(color/special/background/page-bg)\"`, `colorToken: \"var(color/text/01)\"`. The walker resolves these to the actual variable binding so light/dark mode swaps cleanly. Raw hex breaks dark mode.",
  "  - To discover token names, call get_variables — Hydrogen DS publishes color, spacing, radius, breakpoint collections.",
  "  - Standard composition values:",
  "    • Page outer padding: 24 (use until the layout/spacing token is bound)",
  "    • Card padding: 16",
  "    • Card-to-card gap: 16",
  "    • Section gap: 24",
  "    • Sidebar width: 256",
  "    • Content area max width: 1184 (for 1440 frames with 256 sidebar)",
  "    • Standard frame heights: 1024 (most templates), 982 (list/dashboard), 900 (onboarding)",
].join("\n");

export async function handleChat(c: Context, deps: ChatDeps) {
  let body: ChatRequest;
  try {
    body = await c.req.json<ChatRequest>();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  if (!body.prompt || typeof body.prompt !== "string") {
    return c.json({ error: "missing_prompt" }, 400);
  }

  if (body.sessionId) deps.touchSession?.(body.sessionId);

  return streamSSE(c, async (stream) => {
    const startedAt = Date.now();
    const router = new ToolRouter(stream);
    registerRouter(router);

    let totalCostUsd = 0;
    let didEmitMeta = false;

    try {
      const sdk = await importSdk();
      const mcpServer = buildPoseidonMcpServer(router);

      const skillPrompt = buildSkillSystemPrompt(deps.skills);
      const systemPrompt = skillPrompt
        ? `${SYSTEM_PROMPT_BASE}\n\n${skillPrompt}`
        : SYSTEM_PROMPT_BASE;

      const opts = defaultQueryOptions({
        ...(body.model ? { model: body.model } : {}),
        ...(body.resume ? { resume: body.resume } : {}),
        systemPrompt,
        mcpServers: { poseidon: mcpServer },
        allowedTools: [
          "mcp__poseidon__list_templates",
          "mcp__poseidon__list_components",
          "mcp__poseidon__insert_template",
          "mcp__poseidon__insert_component",
          "mcp__poseidon__emit_recipe",
          "mcp__poseidon__modify_node",
          "mcp__poseidon__swap_theme",
          "mcp__poseidon__swap_density",
          "mcp__poseidon__read_selection",
          "mcp__poseidon__get_canvas_state",
          "mcp__poseidon__figma_execute",
          "mcp__poseidon__get_styles",
          "mcp__poseidon__get_variables",
          "mcp__poseidon__capture_screenshot",
          "mcp__poseidon__ask_user",
          "mcp__poseidon__capture_template",
        ],
        // Disable built-in Claude Code tools; Poseidon exposes its own.
        tools: [],
      });

      await stream.writeSSE({
        event: "meta",
        data: JSON.stringify({
          streamId: router.id,
          model: opts.model,
          startedAt,
        }),
      });
      didEmitMeta = true;

      const it = sdk.query({ prompt: body.prompt, options: opts });

      for await (const msg of it) {
        if (msg.type === "result" && msg.subtype === "success") {
          totalCostUsd += msg.total_cost_usd ?? 0;
        }
        await stream.writeSSE({ event: "message", data: JSON.stringify(msg) });
      }

      await stream.writeSSE({
        event: "done",
        data: JSON.stringify({ durationMs: Date.now() - startedAt, costUsd: totalCostUsd }),
      });
    } catch (err) {
      if (!didEmitMeta) {
        // Surface stream id even on early failure so plugin can clean up.
        await stream.writeSSE({
          event: "meta",
          data: JSON.stringify({ streamId: router.id, error: true }),
        });
      }
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ message: (err as Error).message }),
      });
    } finally {
      unregisterRouter(router.id);
    }
  });
}
