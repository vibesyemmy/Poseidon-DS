/**
 * /health composer.
 *
 * Aggregates every individual detection check into a single response the
 * plugin uses to drive its onboarding gate. The plugin only ever looks at
 * the top-level `state` field to decide which screen to render; the per-check
 * details are surfaced for diagnostic display.
 *
 * Phase 1.6 — this file.
 *
 * Gate states map onto PLAN §3 (precedence top-to-bottom):
 *
 *   bridge-unreachable        ← never returned here (plugin sees fetch failure)
 *   claude-code-missing       ← ~/.claude dir or `claude` binary not found
 *   claude-code-unauthed      ← SDK ping returned authentication_failed
 *   claude-code-no-credit     ← SDK ping returned billing_error
 *   ds-library-disabled       ← plugin-side check, never returned here
 *   ok                        ← all checks passed
 */

import { checkClaudeBinary, checkClaudeDir, type CheckResult } from "./claudeCode.ts";
import { pingClaudeCode, type PingDetails } from "./agentSdk.ts";

export type GateState =
  | "ok"
  | "claude-code-missing"
  | "claude-code-unauthed"
  | "claude-code-no-credit"
  | "anthropic-unreachable"
  | "sdk-init-failed";

/** A skipped detection step (downstream check bypassed because an upstream one failed). */
type SkippedCheck = { ok: false; code: "skipped"; message: string };

export interface HealthReport {
  state: GateState;
  /** Single-line message suitable for surfacing in plugin UI. */
  message: string;
  /** Per-check details, present even when state === "ok". */
  checks: {
    claudeDir: CheckResult<unknown>;
    claudeBinary: CheckResult<unknown> | SkippedCheck;
    /** Skipped when earlier checks failed. */
    anthropicPing: CheckResult<PingDetails> | SkippedCheck;
  };
  /** UNIX millis. Useful for plugin cache-busting. */
  timestamp: number;
}

export interface HealthOptions {
  /**
   * When true, skip the Anthropic ping. Saves ~3.5s + ~$0.0002 — useful when
   * the plugin only needs a fast liveness check (e.g. during polling on the
   * unreachable screen). Default false.
   */
  skipPing?: boolean;
}

export async function getHealth(options: HealthOptions = {}): Promise<HealthReport> {
  const claudeDir = await checkClaudeDir();
  if (!claudeDir.ok) {
    return {
      state: "claude-code-missing",
      message: claudeDir.message,
      checks: {
        claudeDir,
        claudeBinary: skip("claude-dir failed"),
        anthropicPing: skip("claude-dir failed"),
      },
      timestamp: Date.now(),
    };
  }

  const claudeBinary = await checkClaudeBinary();
  if (!claudeBinary.ok) {
    return {
      state: "claude-code-missing",
      message: claudeBinary.message,
      checks: {
        claudeDir,
        claudeBinary,
        anthropicPing: skip("claude-binary failed"),
      },
      timestamp: Date.now(),
    };
  }

  if (options.skipPing) {
    return {
      state: "ok",
      message: "Filesystem checks passed; SDK ping skipped.",
      checks: {
        claudeDir,
        claudeBinary,
        anthropicPing: skip("skipPing=true"),
      },
      timestamp: Date.now(),
    };
  }

  const ping = await pingClaudeCode();
  if (!ping.ok) {
    return {
      state: mapPingCodeToState(ping.code),
      message: ping.message,
      checks: { claudeDir, claudeBinary, anthropicPing: ping },
      timestamp: Date.now(),
    };
  }

  return {
    state: "ok",
    message: ping.message,
    checks: { claudeDir, claudeBinary, anthropicPing: ping },
    timestamp: Date.now(),
  };
}

function skip(reason: string): SkippedCheck {
  return { ok: false, code: "skipped", message: `skipped: ${reason}` };
}

function mapPingCodeToState(code: CheckResult<unknown>["code"]): GateState {
  switch (code) {
    case "anthropic-unauthed":
      return "claude-code-unauthed";
    case "anthropic-no-credit":
      return "claude-code-no-credit";
    case "anthropic-unreachable":
      return "anthropic-unreachable";
    case "sdk-init-failed":
      return "sdk-init-failed";
    default:
      return "anthropic-unreachable";
  }
}
