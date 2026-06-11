/**
 * STEP 3 — composer state machine for template-first UI enforcement.
 *
 * Lives alongside the chat surface. Tracks template-first mode + the
 * current proposal state so the chat UI can render the right confirmation
 * card (MatchedTemplateCard / NoMatchCard / ComposeFromAtomsConfirmModal).
 *
 * See ENFORCEMENT.md → STEP 3.
 */

import type {
  NoMatchProposal,
  TemplateProposal,
} from "../../shared/messages.ts";

export type ComposerMode =
  | "TEMPLATE_FIRST_ON" // default
  | "TEMPLATE_FIRST_OFF_TEMPORARY"; // 30 min auto-revert

export type ComposerPhase =
  | "IDLE"
  | "AWAITING_PROPOSAL" // we sent the prompt; waiting for matched / no-match
  | "AWAITING_DECISION" // proposal landed; designer must accept / reject
  | "AWAITING_COMPOSE_CONFIRM" // no-match → ComposeFromAtomsConfirmModal
  | "MUTATION_IN_FLIGHT";

export interface ComposerState {
  mode: ComposerMode;
  /** Wall-clock ms when TEMPLATE_FIRST_OFF_TEMPORARY auto-reverts. */
  modeRevertAt?: number;
  phase: ComposerPhase;
  matched?: TemplateProposal;
  noMatch?: NoMatchProposal;
  approvedMutationProposalId?: string;
  /** Count of compose-from-atoms overrides in this session (drives escalating copy). */
  overrideCount: number;
}

export const initialComposerState: ComposerState = {
  mode: "TEMPLATE_FIRST_ON",
  phase: "IDLE",
  overrideCount: 0,
};

export type ComposerEvent =
  | { type: "SEND_PROMPT" }
  | { type: "PROPOSAL_MATCHED"; proposal: TemplateProposal }
  | { type: "PROPOSAL_NO_MATCH"; proposal: NoMatchProposal }
  | { type: "ACCEPT" }
  | { type: "PICK_DIFFERENT" }
  | { type: "REQUEST_COMPOSE" } // designer wants to compose-from-atoms via the modal
  | { type: "CONFIRM_COMPOSE" }
  | { type: "CANCEL" }
  | { type: "MUTATION_COMPLETE" }
  | { type: "TOGGLE_TEMPLATE_FIRST_OFF_30MIN" }
  | { type: "TOGGLE_TEMPLATE_FIRST_ON" }
  | { type: "TICK"; now: number };

/** Pure reducer — easy to unit-test. */
export function composerReducer(
  state: ComposerState,
  event: ComposerEvent,
): ComposerState {
  switch (event.type) {
    case "SEND_PROMPT":
      return { ...state, phase: "AWAITING_PROPOSAL" };

    case "PROPOSAL_MATCHED":
      return {
        ...state,
        phase: "AWAITING_DECISION",
        matched: event.proposal,
        noMatch: undefined,
      };

    case "PROPOSAL_NO_MATCH":
      return {
        ...state,
        phase: "AWAITING_DECISION",
        matched: undefined,
        noMatch: event.proposal,
      };

    case "ACCEPT":
      if (!state.matched) return state;
      return {
        ...state,
        phase: "MUTATION_IN_FLIGHT",
        approvedMutationProposalId: state.matched.proposalId,
      };

    case "PICK_DIFFERENT":
      return { ...state, phase: "IDLE", matched: undefined };

    case "REQUEST_COMPOSE":
      if (state.phase !== "AWAITING_DECISION" || !state.noMatch) return state;
      return { ...state, phase: "AWAITING_COMPOSE_CONFIRM" };

    case "CONFIRM_COMPOSE":
      if (state.phase !== "AWAITING_COMPOSE_CONFIRM") return state;
      return {
        ...state,
        phase: "MUTATION_IN_FLIGHT",
        approvedMutationProposalId: state.noMatch?.proposalId,
        overrideCount: state.overrideCount + 1,
      };

    case "CANCEL":
      return { ...state, phase: "IDLE", matched: undefined, noMatch: undefined };

    case "MUTATION_COMPLETE":
      return { ...state, phase: "IDLE", approvedMutationProposalId: undefined };

    case "TOGGLE_TEMPLATE_FIRST_OFF_30MIN":
      return {
        ...state,
        mode: "TEMPLATE_FIRST_OFF_TEMPORARY",
        modeRevertAt: Date.now() + 30 * 60 * 1000,
      };

    case "TOGGLE_TEMPLATE_FIRST_ON":
      return { ...state, mode: "TEMPLATE_FIRST_ON", modeRevertAt: undefined };

    case "TICK":
      if (
        state.mode === "TEMPLATE_FIRST_OFF_TEMPORARY" &&
        state.modeRevertAt &&
        event.now >= state.modeRevertAt
      ) {
        return { ...state, mode: "TEMPLATE_FIRST_ON", modeRevertAt: undefined };
      }
      return state;

    default:
      return state;
  }
}
