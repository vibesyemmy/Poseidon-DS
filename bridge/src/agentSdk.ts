/**
 * Claude Agent SDK wrapper.
 *
 * The SDK spawns the user's local `claude` binary as its backend, so it
 * automatically uses whatever credentials Claude Code is logged in with —
 * no API key needed in this process.
 *
 * Phase 1 responsibilities:
 *   1.4  defaultQueryOptions()      shared SDK config for /chat
 *   1.4  importSdk()                lazy ESM import (keeps server startup fast)
 *   1.5  pingClaudeCode()           minimal round-trip to verify auth + credit
 *
 * Later phases extend this with:
 *   - MCP tool registration (Phase 4)
 *   - Plugin (skills) registration (Phase 6)
 *   - Session manager wrapping query() for multi-turn chat (Phase 4 / 5)
 */

import type {
  Options,
  SDKAssistantMessageError,
  SDKMessage,
  SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";

import type { CheckResult } from "./claudeCode.ts";

// ─────────────────────────────────────────────────────────────────────────
// SDK module — lazy import so server boot stays sub-50ms
// ─────────────────────────────────────────────────────────────────────────

type SdkModule = typeof import("@anthropic-ai/claude-agent-sdk");
let cachedSdk: SdkModule | null = null;

/**
 * Lazily import the Agent SDK. We avoid importing it at module load because
 * the SDK has its own startup cost and we want `/ping` to stay snappy even
 * when the user hasn't installed Claude Code yet.
 */
export async function importSdk(): Promise<SdkModule> {
  if (!cachedSdk) {
    cachedSdk = await import("@anthropic-ai/claude-agent-sdk");
  }
  return cachedSdk;
}

// ─────────────────────────────────────────────────────────────────────────
// Defaults — used by /chat (Phase 1.7) and by pingClaudeCode below.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Default model. Sonnet 4.5 is the current production design copilot. The
 * `/chat` route may override per-request once we expose a model picker.
 */
export const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

/**
 * Sensible defaults for the SDK `query()` Options used by chat. Callers can
 * shallow-merge their own additions on top.
 *
 * - `settingSources: []` — SDK isolation. We don't want random project
 *   `.claude/settings.json` files to inject behavior into Poseidon.
 * - `persistSession: false` — chat history lives in the Figma plugin's
 *   `clientStorage`, not on disk. The SDK doesn't need to mirror it.
 * - `tools: []` — disable built-in Claude Code tools (Read/Write/Bash/etc).
 *   Poseidon exposes its own design-only tool surface via MCP later.
 */
export function defaultQueryOptions(overrides: Partial<Options> = {}): Options {
  return {
    model: DEFAULT_MODEL,
    settingSources: [],
    persistSession: false,
    tools: [],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Phase 1.5 — ping Anthropic via the SDK
// ─────────────────────────────────────────────────────────────────────────

export interface PingDetails {
  /** Round-trip wall-clock duration in milliseconds. */
  durationMs: number;
  /** Cost in USD reported by the SDK, if any. ≈ $0.0001 for a 1-token reply. */
  costUsd: number | null;
  /** First few characters of the model's reply — for debugging only. */
  sample: string | null;
  /** Underlying SDK error class when ping failed. */
  errorClass?: SDKAssistantMessageError | "no_result" | "no_messages";
}

/**
 * Run a tiny `query()` to verify the SDK can reach Anthropic with the user's
 * Claude Code credentials. Returns a structured result the /health composer
 * (Phase 1.6) can route into a gate state.
 *
 * Cost: ~$0.0001 (one input token + one output token at Sonnet pricing). Cap
 * is enforced via `maxBudgetUsd` so we can't accidentally run away.
 */
export async function pingClaudeCode(): Promise<CheckResult<PingDetails>> {
  const sdk = await importSdk().catch((err) => {
    throw err;
  });

  const started = Date.now();
  const PROMPT = "Reply with the single word: pong";

  let lastResult: SDKResultMessage | null = null;
  let assistantSample = "";
  let assistantError: SDKAssistantMessageError | undefined;

  try {
    const stream = sdk.query({
      prompt: PROMPT,
      options: defaultQueryOptions({
        maxTurns: 1,
        maxBudgetUsd: 0.05, // generous ceiling; real cost is ~$0.0001
      }),
    });

    for await (const msg of stream as AsyncIterable<SDKMessage>) {
      if (msg.type === "assistant" && msg.error) {
        assistantError = msg.error;
      }
      if (msg.type === "assistant" && !assistantSample) {
        const content = msg.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text" && typeof block.text === "string") {
              assistantSample = block.text.slice(0, 40);
              break;
            }
          }
        }
      }
      if (msg.type === "result") {
        lastResult = msg;
      }
    }
  } catch (err) {
    return {
      ok: false,
      code: "sdk-init-failed",
      message: `Agent SDK threw before producing a result: ${(err as Error).message}`,
      details: {
        durationMs: Date.now() - started,
        costUsd: null,
        sample: null,
      },
    };
  }

  const durationMs = Date.now() - started;

  if (!lastResult) {
    return {
      ok: false,
      code: "anthropic-unreachable",
      message: "Agent SDK stream ended without a result message.",
      details: { durationMs, costUsd: null, sample: null, errorClass: "no_result" },
    };
  }

  // Error classification — map SDK error subtypes to our gate codes.
  if (lastResult.subtype !== "success" || lastResult.is_error) {
    const cls = assistantError ?? mapResultSubtypeToErrorClass(lastResult.subtype);
    const code = errorClassToGateCode(cls);
    return {
      ok: false,
      code,
      message: messageForErrorClass(cls, lastResult),
      details: {
        durationMs,
        costUsd: lastResult.total_cost_usd ?? null,
        sample: assistantSample || null,
        errorClass: cls,
      },
    };
  }

  return {
    ok: true,
    code: "ok",
    message: `Anthropic reachable via Claude Code (${durationMs}ms).`,
    details: {
      durationMs,
      costUsd: lastResult.total_cost_usd ?? null,
      sample: assistantSample || lastResult.result?.slice(0, 40) || null,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function mapResultSubtypeToErrorClass(
  subtype: SDKResultMessage["subtype"],
): SDKAssistantMessageError | "no_messages" {
  switch (subtype) {
    case "error_max_budget_usd":
      return "billing_error";
    case "error_max_turns":
    case "error_max_structured_output_retries":
      return "invalid_request";
    case "error_during_execution":
    default:
      return "unknown";
  }
}

function errorClassToGateCode(
  cls: SDKAssistantMessageError | "no_result" | "no_messages",
): CheckResult["code"] {
  switch (cls) {
    case "authentication_failed":
      return "anthropic-unauthed";
    case "billing_error":
      return "anthropic-no-credit";
    case "rate_limit":
    case "server_error":
    case "unknown":
    case "no_messages":
    case "no_result":
      return "anthropic-unreachable";
    case "invalid_request":
    default:
      return "sdk-init-failed";
  }
}

function messageForErrorClass(
  cls: SDKAssistantMessageError | "no_messages",
  result: SDKResultMessage,
): string {
  const detail = "result" in result && result.result ? ` (${result.result.slice(0, 120)})` : "";
  switch (cls) {
    case "authentication_failed":
      return `Claude Code is not authenticated. Run 'claude login'.${detail}`;
    case "billing_error":
      return `Claude Code subscription has no credit available.${detail}`;
    case "rate_limit":
      return `Anthropic rate-limited the request. Wait and retry.${detail}`;
    case "server_error":
      return `Anthropic server error.${detail}`;
    case "invalid_request":
      return `Agent SDK invalid request — likely a Poseidon bug, not user error.${detail}`;
    case "no_messages":
      return `SDK produced no assistant messages.${detail}`;
    default:
      return `Unknown SDK error.${detail}`;
  }
}
