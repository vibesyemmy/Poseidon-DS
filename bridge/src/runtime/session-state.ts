/**
 * STEP 2 — per-stream session state for the template-first tool-gate.
 *
 * Lifetime: created on first access for a streamId, dropped on session end
 * via `dropState(streamId)`. Idle TTL is enforced by the bridge's existing
 * `activeSessions` heartbeat — sessions that drop also drop their state.
 *
 * See ENFORCEMENT.md → STEP 2 for the state contract.
 */

export type Phase =
  | "idle"
  | "suggested"
  | "chosen"
  | "no_match_declared"
  | "atoms_unlocked";

export interface VariantSummary {
  variantKey: string; // e.g. "page.list.transactions"
  name: string;
  family: "List" | "Detail" | "Form" | "Onboarding" | "Settings";
  useWhen: string;
  dontUseWhen: string;
  /** 0..1 confidence from rankByIntent. */
  score: number;
  /** Slug used by insert_template / list_templates. */
  recipeSlug: string;
}

export interface SessionState {
  conversationId: string;
  phase: Phase;
  lastSuggestion?: { intent: string; variants: VariantSummary[]; at: number };
  choice?: { variantKey: string; reason: string; at: number };
  noMatchDeclaredAt?: number;
  /** Designer answer captured from ask_user after a no-match. */
  composeUserConfirmation?: string;
}

const stores = new Map<string, SessionState>();

export function getState(streamId: string): SessionState {
  let s = stores.get(streamId);
  if (!s) {
    s = { conversationId: streamId, phase: "idle" };
    stores.set(streamId, s);
  }
  return s;
}

export function setPhase(streamId: string, phase: Phase): void {
  const s = getState(streamId);
  s.phase = phase;
}

export function dropState(streamId: string): void {
  stores.delete(streamId);
}

export function _resetAll(): void {
  stores.clear();
}
