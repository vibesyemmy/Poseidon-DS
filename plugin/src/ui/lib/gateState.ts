/**
 * Onboarding gate state resolver.
 *
 * Combines bridge `/health` state with the plugin-side DS-library check
 * and returns the single screen the UI should render. Precedence is
 * documented in PLAN §3.
 */

import type { HealthReport } from "./bridgeClient.ts";
import type { DsLibraryStatus } from "../../shared/messages.ts";

export type GateScreen =
  | "loading"
  | "bridge-unreachable"
  | "claude-code-missing"
  | "claude-code-unauthed"
  | "claude-code-no-credit"
  | "anthropic-unreachable"
  | "sdk-init-failed"
  | "ds-library-disabled"
  | "ok";

export interface GateInput {
  /** null = haven't heard from bridge yet (loading); BridgeUnreachable surfaces as null too. */
  health: HealthReport | null;
  /** True = bridge responded (regardless of state); false = network failure. */
  bridgeReachable: boolean;
  /** null = haven't heard from sandbox yet. */
  dsLibrary: DsLibraryStatus | null;
}

export function resolveGate(input: GateInput): GateScreen {
  if (!input.bridgeReachable) return "bridge-unreachable";
  if (!input.health) return "loading";

  switch (input.health.state) {
    case "claude-code-missing":
      return "claude-code-missing";
    case "claude-code-unauthed":
      return "claude-code-unauthed";
    case "claude-code-no-credit":
      return "claude-code-no-credit";
    case "anthropic-unreachable":
      return "anthropic-unreachable";
    case "sdk-init-failed":
      return "sdk-init-failed";
    case "ok":
      break;
  }

  if (!input.dsLibrary) return "loading";
  if (!input.dsLibrary.hasHydrogen) return "ds-library-disabled";

  return "ok";
}
