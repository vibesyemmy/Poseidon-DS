/**
 * STEP 3 — mutation watcher
 *
 * Plugin-side guard. Every time the sandbox emits a mutation (insert_template,
 * insert_component, emit_recipe, modify_node, screen_from_template,
 * screen_compose_from_atoms, figma_execute), this module checks the
 * mutationId against the set of UI-approved proposalIds. Mismatch → red
 * banner + audit log entry.
 *
 * The sandbox also independently rejects unapproved mutations with
 * `MUTATION_REJECTED_NO_APPROVAL` so the gate is enforced even if the UI
 * banner is dismissed.
 */

import type { TemplateAuditEntry } from "../shared/messages.ts";

import { logAudit } from "../audit/logger.ts";

const approvedProposals = new Set<string>();
const seenMutationIds = new Set<string>();

interface MutationIntent {
  mutationId: string;
  tool: string;
  proposalId?: string;
}

interface WatcherCallbacks {
  onUnapprovedMutation: (intent: MutationIntent) => void;
  onStructuralDivergence: (intent: MutationIntent, reason: string) => void;
}

export function approveProposal(proposalId: string): void {
  approvedProposals.add(proposalId);
}

export function revokeProposal(proposalId: string): void {
  approvedProposals.delete(proposalId);
}

export function isApproved(proposalId?: string): boolean {
  if (!proposalId) return false;
  return approvedProposals.has(proposalId);
}

const SCREEN_TOOLS = new Set([
  "insert_template",
  "insert_component",
  "emit_recipe",
  "modify_node",
  "screen_from_template",
  "screen_compose_from_atoms",
  "figma_execute",
]);

export function isScreenTool(tool: string): boolean {
  return SCREEN_TOOLS.has(tool);
}

export function recordMutation(
  intent: MutationIntent,
  callbacks: WatcherCallbacks,
  auditMeta: Omit<TemplateAuditEntry, "decision" | "timestamp" | "mutationProposalId">,
): void {
  if (!isScreenTool(intent.tool)) return;
  if (seenMutationIds.has(intent.mutationId)) return;
  seenMutationIds.add(intent.mutationId);

  if (!isApproved(intent.proposalId)) {
    callbacks.onUnapprovedMutation(intent);
    void logAudit({
      ...auditMeta,
      timestamp: new Date().toISOString(),
      decision: "compose_override",
      mutationProposalId: intent.proposalId,
    });
  }
}

/**
 * Post-mutation diff validator.
 *
 * Hook compares the emitted node tree against the approved template
 * skeleton. If structural divergence (missing nodes, wrong ordering),
 * surface a banner.
 *
 * Caller passes:
 *   - expectedSkeleton: minimum required node names (in order) from
 *     templates-index for this variantKey
 *   - emittedNodeNames: actual names from the sandbox after insert
 */
export function validateAgainstSkeleton(
  intent: MutationIntent,
  expectedSkeleton: string[],
  emittedNodeNames: string[],
  callbacks: Pick<WatcherCallbacks, "onStructuralDivergence">,
): boolean {
  const missing = expectedSkeleton.filter((name) => !emittedNodeNames.includes(name));
  if (missing.length === 0) return true;
  callbacks.onStructuralDivergence(
    intent,
    `Built output diverged from approved template. Missing: ${missing.join(", ")}.`,
  );
  return false;
}

export function _resetForTests(): void {
  approvedProposals.clear();
  seenMutationIds.clear();
}
