/**
 * STEP 3 — MatchedTemplateCard
 *
 * Inline confirmation card the chat renders when the bridge returns a
 * template proposal (templates.suggest top result). Designer accepts,
 * picks a different variant, or declares no-match.
 *
 * Accept is intentionally disabled for 2s on the designer's first 3
 * sessions to defeat reflexive Enter-spam.
 */

import { useEffect, useState } from "preact/hooks";

import type { TemplateProposal } from "../../shared/messages.ts";

interface Props {
  proposal: TemplateProposal;
  /** True for the designer's first 3 sessions on this machine. */
  defeatReflexive: boolean;
  onAccept: () => void;
  onPickDifferent: () => void;
  onNoMatch: () => void;
}

const REFLEX_DELAY_MS = 2000;

export function MatchedTemplateCard({
  proposal,
  defeatReflexive,
  onAccept,
  onPickDifferent,
  onNoMatch,
}: Props) {
  const [acceptEnabled, setAcceptEnabled] = useState(!defeatReflexive);

  useEffect(() => {
    if (defeatReflexive) {
      const t = setTimeout(() => setAcceptEnabled(true), REFLEX_DELAY_MS);
      return () => clearTimeout(t);
    }
  }, [defeatReflexive]);

  const confidencePct = Math.round(proposal.score * 100);

  return (
    <div class="poseidon-card poseidon-matched-card">
      <header class="poseidon-card__header">
        <span class="poseidon-card__title">Matched template</span>
        <span class="poseidon-card__family">{proposal.family} · {confidencePct}% confident</span>
      </header>

      <p class="poseidon-card__name">{proposal.variantName}</p>
      {proposal.thumbnailUrl && (
        <img src={proposal.thumbnailUrl} alt={proposal.variantName} class="poseidon-card__thumb" />
      )}

      <dl class="poseidon-card__rationale">
        <dt>Use when</dt>
        <dd>{proposal.useWhen}</dd>
        <dt>Don't use when</dt>
        <dd>{proposal.dontUseWhen}</dd>
      </dl>

      <footer class="poseidon-card__actions">
        <button
          type="button"
          autofocus
          disabled={!acceptEnabled}
          onClick={onAccept}
          class="poseidon-btn poseidon-btn--primary"
        >
          {acceptEnabled ? "Accept" : "Accept (review first…)"}
        </button>
        <button type="button" onClick={onPickDifferent} class="poseidon-btn">
          Pick different
        </button>
        <button type="button" onClick={onNoMatch} class="poseidon-btn poseidon-btn--ghost">
          No match
        </button>
      </footer>
    </div>
  );
}
