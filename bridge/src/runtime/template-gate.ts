/**
 * STEP 2 — deterministic template-first tool-gate.
 *
 * Five guarded tools live in tools.ts; this module supplies the gate
 * primitives they use:
 *
 *   templates.suggest         → setSuggested
 *   templates.choose          → assertSuggested + setChosen
 *   screen.from_template      → assertChosen + matchingKey
 *   escape.no_template_match  → setNoMatchDeclared
 *   screen.compose_from_atoms → assertNoMatchDeclared + matching answer
 *
 * Any precondition failure returns a GateViolation that the dispatcher
 * forwards to Claude as a tool_result. The model receives the
 * `nextRequiredTool` hint and naturally retries.
 *
 * Every decision is appended to ~/.poseidon/audit.jsonl.
 */

import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { getState, setPhase, type Phase, type VariantSummary } from "./session-state.ts";

export interface GateViolation {
  ok: false;
  code: "TEMPLATE_GATE_VIOLATION";
  message: string;
  details: {
    currentPhase: Phase;
    requiredPhase: Phase | Phase[];
    nextRequiredTool: string;
    hint: string;
  };
}

function violation(
  currentPhase: Phase,
  requiredPhase: Phase | Phase[],
  nextRequiredTool: string,
  hint: string,
): GateViolation {
  return {
    ok: false,
    code: "TEMPLATE_GATE_VIOLATION",
    message: `Screen creation blocked: template-first sequence incomplete.`,
    details: { currentPhase, requiredPhase, nextRequiredTool, hint },
  };
}

// ─── Gate transitions ───────────────────────────────────────────────────

export function setSuggested(
  streamId: string,
  intent: string,
  variants: VariantSummary[],
): void {
  const s = getState(streamId);
  s.phase = "suggested";
  s.lastSuggestion = { intent, variants, at: Date.now() };
  void logDecision({
    conversationId: streamId,
    phase_before: "any",
    tool: "templates.suggest",
    phase_after: "suggested",
    intent,
    candidates: variants.map((v) => v.variantKey),
    at: Date.now(),
  });
}

export function assertSuggested(streamId: string): GateViolation | null {
  const s = getState(streamId);
  if (s.phase !== "suggested") {
    return violation(
      s.phase,
      "suggested",
      "templates.suggest",
      "Call templates.suggest with the designer's intent first. The result lists candidate variants you can then choose from.",
    );
  }
  return null;
}

export function setChosen(
  streamId: string,
  variantKey: string,
  reason: string,
): GateViolation | null {
  const s = getState(streamId);
  if (s.phase !== "suggested") {
    return violation(
      s.phase,
      "suggested",
      "templates.suggest",
      "Call templates.suggest first; templates.choose only valid right after.",
    );
  }
  const inSuggestion = s.lastSuggestion?.variants.some(
    (v) => v.variantKey === variantKey,
  );
  if (!inSuggestion) {
    return violation(
      s.phase,
      "suggested",
      "templates.suggest",
      `variantKey '${variantKey}' was not in the most recent suggestion. Re-suggest, or pick one of the returned candidates.`,
    );
  }
  if (!reason || reason.length < 20) {
    return violation(
      s.phase,
      "suggested",
      "templates.choose",
      "templates.choose requires a 20+ char reason explaining the variant fits the intent.",
    );
  }
  s.phase = "chosen";
  s.choice = { variantKey, reason, at: Date.now() };
  void logDecision({
    conversationId: streamId,
    phase_before: "suggested",
    tool: "templates.choose",
    phase_after: "chosen",
    variantKey,
    reason,
    at: Date.now(),
  });
  return null;
}

export function assertChosenMatching(
  streamId: string,
  variantKey: string,
): GateViolation | null {
  const s = getState(streamId);
  if (s.phase !== "chosen") {
    return violation(
      s.phase,
      "chosen",
      "templates.choose",
      "Call templates.choose with a previously suggested variantKey before screen.from_template.",
    );
  }
  if (s.choice?.variantKey !== variantKey) {
    return violation(
      s.phase,
      "chosen",
      "templates.choose",
      `screen.from_template variantKey '${variantKey}' does not match the chosen variant '${s.choice?.variantKey}'.`,
    );
  }
  return null;
}

export function resetIdle(streamId: string): void {
  const s = getState(streamId);
  s.phase = "idle";
  delete s.choice;
  delete s.lastSuggestion;
  delete s.noMatchDeclaredAt;
  delete s.composeUserConfirmation;
}

export function setNoMatchDeclared(
  streamId: string,
  intent: string,
  considered: VariantSummary[],
  rationale: string,
): GateViolation | null {
  if (!considered || considered.length < 3) {
    return violation(
      getState(streamId).phase,
      "any",
      "escape.no_template_match",
      "escape.no_template_match requires at least 3 considered variants with the Use-when/Don't-use-when lines that rejected each.",
    );
  }
  if (!rationale || rationale.length < 40) {
    return violation(
      getState(streamId).phase,
      "any",
      "escape.no_template_match",
      "escape.no_template_match requires a 40+ char rationale summarizing why none of the considered variants fit.",
    );
  }
  const s = getState(streamId);
  s.phase = "no_match_declared";
  s.noMatchDeclaredAt = Date.now();
  s.lastSuggestion = { intent, variants: considered, at: Date.now() };
  void logDecision({
    conversationId: streamId,
    phase_before: "any",
    tool: "escape.no_template_match",
    phase_after: "no_match_declared",
    intent,
    candidates: considered.map((v) => v.variantKey),
    rationale,
    at: Date.now(),
  });
  return null;
}

export function assertNoMatchAndConfirmation(
  streamId: string,
  userConfirmation: string,
): GateViolation | null {
  const s = getState(streamId);
  if (s.phase !== "no_match_declared") {
    return violation(
      s.phase,
      "no_match_declared",
      "escape.no_template_match",
      "screen.compose_from_atoms requires a prior escape.no_template_match call AND an ask_user answer authorizing the compose.",
    );
  }
  if (!userConfirmation || userConfirmation.trim().length < 4) {
    return violation(
      s.phase,
      "no_match_declared",
      "ask_user",
      "screen.compose_from_atoms requires the designer's literal answer from ask_user (passed verbatim as userConfirmation).",
    );
  }
  // Optional cross-check: store the designer's answer if previously captured.
  if (
    s.composeUserConfirmation &&
    s.composeUserConfirmation !== userConfirmation
  ) {
    return violation(
      s.phase,
      "no_match_declared",
      "ask_user",
      "userConfirmation does not match the recorded designer answer for this session.",
    );
  }
  void logDecision({
    conversationId: streamId,
    phase_before: "no_match_declared",
    tool: "screen.compose_from_atoms",
    phase_after: "idle",
    userConfirmation,
    at: Date.now(),
  });
  return null;
}

export function recordUserConfirmation(streamId: string, answer: string): void {
  const s = getState(streamId);
  s.composeUserConfirmation = answer;
}

// ─── Audit log ──────────────────────────────────────────────────────────

const AUDIT_PATH =
  process.env.POSEIDON_AUDIT_PATH ||
  join(homedir(), ".poseidon", "audit.jsonl");

let auditDirEnsured = false;

async function ensureAuditDir() {
  if (auditDirEnsured) return;
  await mkdir(dirname(AUDIT_PATH), { recursive: true });
  auditDirEnsured = true;
}

interface GateDecisionEntry {
  conversationId: string;
  phase_before: Phase | "any";
  tool: string;
  phase_after: Phase;
  variantKey?: string;
  reason?: string;
  intent?: string;
  candidates?: string[];
  rationale?: string;
  userConfirmation?: string;
  at: number;
}

export async function logDecision(entry: GateDecisionEntry): Promise<void> {
  try {
    await ensureAuditDir();
    await appendFile(
      AUDIT_PATH,
      JSON.stringify({ kind: "gate_decision", ...entry }) + "\n",
      "utf8",
    );
  } catch (err) {
    console.warn("[poseidon] gate audit failed:", (err as Error).message);
  }
}

export function getAuditPath(): string {
  return AUDIT_PATH;
}
