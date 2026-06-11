/**
 * STEP 3 — NoMatchCard
 *
 * Renders when escape.no_template_match fires. Shows the 2-3 closest
 * considered variants as rejection chips. Each chip must be expanded
 * (read the rejection reason) before the chip's "use this variant
 * instead" button enables.
 *
 * Footer has three actions:
 *   - Compose from atoms  (gated by ComposeFromAtomsConfirmModal)
 *   - Refine intent       (loops back to prompt input)
 *   - Add new template    (placeholder — opens authoring drawer in Phase 7)
 */

import { useState } from "preact/hooks";

import type { NoMatchProposal, TemplateProposal } from "../../shared/messages.ts";

interface Props {
  proposal: NoMatchProposal;
  onUseAnyway: (variantKey: string) => void;
  onComposeFromAtoms: () => void;
  onRefineIntent: () => void;
  onAddNewTemplate: () => void;
}

interface ChipProps {
  variant: TemplateProposal;
  onUseAnyway: (variantKey: string) => void;
}

function RejectionChip({ variant, onUseAnyway }: ChipProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div class={`poseidon-chip ${expanded ? "poseidon-chip--expanded" : ""}`}>
      <button
        type="button"
        class="poseidon-chip__header"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        <span class="poseidon-chip__name">{variant.variantName}</span>
        <span class="poseidon-chip__family">{variant.family}</span>
        <span class="poseidon-chip__caret">{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded && (
        <div class="poseidon-chip__body">
          <p>
            <strong>Don't use when:</strong> {variant.dontUseWhen}
          </p>
          <button
            type="button"
            class="poseidon-btn poseidon-btn--small"
            onClick={() => onUseAnyway(variant.variantKey)}
          >
            Use this variant anyway
          </button>
        </div>
      )}
    </div>
  );
}

export function NoMatchCard({
  proposal,
  onUseAnyway,
  onComposeFromAtoms,
  onRefineIntent,
  onAddNewTemplate,
}: Props) {
  return (
    <div class="poseidon-card poseidon-nomatch-card">
      <header class="poseidon-card__header">
        <span class="poseidon-card__title">No template matched</span>
      </header>
      <p class="poseidon-card__intent">
        Parsed intent: <em>{proposal.intent}</em>
      </p>
      <p class="poseidon-card__rationale-line">{proposal.rationale}</p>

      <p class="poseidon-card__subtitle">Closest considered (expand to read why each was rejected):</p>
      <div class="poseidon-chips">
        {proposal.considered.map((v) => (
          <RejectionChip key={v.variantKey} variant={v} onUseAnyway={onUseAnyway} />
        ))}
      </div>

      <footer class="poseidon-card__actions">
        <button type="button" onClick={onRefineIntent} class="poseidon-btn poseidon-btn--primary">
          Refine intent
        </button>
        <button type="button" onClick={onAddNewTemplate} class="poseidon-btn">
          Add new template
        </button>
        <button type="button" onClick={onComposeFromAtoms} class="poseidon-btn poseidon-btn--ghost">
          Compose from atoms
        </button>
      </footer>
    </div>
  );
}
