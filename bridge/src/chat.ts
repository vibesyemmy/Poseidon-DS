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
import { TEMPLATE_FIRST_RULE } from "./prompts/template-first-rule.ts";
import {
  isScreenCreationTool,
  logAudit,
  parsePreamble,
  stripMcpPrefix,
  summarizeToolArgs,
} from "./templateCheck.ts";
import { dropState } from "./runtime/session-state.ts";

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
      // Append the template-first hard rule LAST so it has the strongest
      // recency weight against long histories. STEP 1 of ENFORCEMENT.md.
      const systemPrompt = [
        SYSTEM_PROMPT_BASE,
        skillPrompt,
        TEMPLATE_FIRST_RULE,
      ]
        .filter(Boolean)
        .join("\n\n");

      const opts = defaultQueryOptions({
        ...(body.model ? { model: body.model } : {}),
        ...(body.resume ? { resume: body.resume } : {}),
        systemPrompt,
        mcpServers: { poseidon: mcpServer },
        allowedTools: [
          // Read-only / non-screen tools — always allowed.
          "mcp__poseidon__list_templates",
          "mcp__poseidon__list_components",
          "mcp__poseidon__read_selection",
          "mcp__poseidon__get_canvas_state",
          "mcp__poseidon__get_styles",
          "mcp__poseidon__get_variables",
          "mcp__poseidon__capture_screenshot",
          "mcp__poseidon__ask_user",
          "mcp__poseidon__capture_template",
          "mcp__poseidon__swap_theme",
          "mcp__poseidon__swap_density",
          // STEP 2 — template-first tool-gate (the ONLY exposed screen-creation path).
          "mcp__poseidon__templates_suggest",
          "mcp__poseidon__templates_choose",
          "mcp__poseidon__screen_from_template",
          "mcp__poseidon__escape_no_template_match",
          "mcp__poseidon__screen_compose_from_atoms",
          // Component-level edits — bypass the screen gate; still bound by skill rule.
          "mcp__poseidon__insert_component",
          "mcp__poseidon__modify_node",
          // NOTE: insert_template, emit_recipe, figma_execute are intentionally
          // OMITTED from allowedTools. The gated screen.* tools delegate to
          // insert_template / emit_recipe internally via the router so the
          // bridge can still build screens — Claude just can't bypass the gate
          // by calling them directly.
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

      // STEP 1 telemetry — accumulate assistant text + tool calls this stream.
      let assistantTextSoFar = "";
      let templatesSuggestCalledThisStream = false;
      let escapeUsedThisStream = false;

      for await (const msg of it) {
        if (msg.type === "result" && msg.subtype === "success") {
          totalCostUsd += msg.total_cost_usd ?? 0;
        }

        // Mine the message for text blocks + tool_use blocks for audit.
        // SDK assistant messages typically have shape:
        //   { type: "assistant", message: { content: [{ type: "text"|"tool_use", ... }] } }
        try {
          const inner = (msg as { message?: { content?: unknown[] } })?.message;
          const content = Array.isArray(inner?.content) ? inner!.content : [];
          for (const block of content) {
            const b = block as { type?: string; text?: string; name?: string; input?: unknown };
            if (b.type === "text" && typeof b.text === "string") {
              assistantTextSoFar += "\n" + b.text;
            } else if (b.type === "tool_use" && typeof b.name === "string") {
              const tool = stripMcpPrefix(b.name);
              if (tool === "list_templates" || tool === "templates_suggest") {
                templatesSuggestCalledThisStream = true;
              }
              if (tool === "ask_user") {
                escapeUsedThisStream = true;
              }
              if (isScreenCreationTool(tool)) {
                const preamble = parsePreamble(assistantTextSoFar);
                const preamblePresent = preamble !== null;
                const variantNone =
                  preamble?.variantKey.toLowerCase() === "none";
                await logAudit({
                  timestamp: new Date().toISOString(),
                  sessionId: body.sessionId,
                  streamId: router.id,
                  toolName: tool,
                  preamblePresent,
                  preambleIntent: preamble?.intent,
                  preambleVariantKey: preamble?.variantKey,
                  templatesSuggestCalled: templatesSuggestCalledThisStream,
                  escapeUsed: escapeUsedThisStream || variantNone,
                  silentComposeAttempted:
                    !preamblePresent ||
                    (variantNone && !escapeUsedThisStream),
                  forcedInjectionFired: false, // STEP 2 will populate this.
                  toolArgsSummary: summarizeToolArgs(b.input),
                });
              }
            }
          }
        } catch (auditErr) {
          // Auditing must never break the chat stream.
          console.warn(
            "[poseidon] template-check audit error:",
            (auditErr as Error).message,
          );
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
      // STEP 2 — clear gate state for this stream so the next session
      // starts at phase='idle' with no carry-over suggestions/choices.
      dropState(router.id);
    }
  });
}
