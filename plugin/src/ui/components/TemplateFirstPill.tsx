/**
 * STEP 3 — TemplateFirstPill
 *
 * Compact toggle + countdown badge above the chat composer. Shows current
 * mode (default ON), allows 30-min temporary OFF with amber warning, and
 * auto-reverts via a TICK event.
 */

import type { ComposerMode } from "../state/composer.ts";

interface Props {
  mode: ComposerMode;
  modeRevertAt?: number;
  onToggleOff: () => void;
  onToggleOn: () => void;
}

function fmtRemaining(revertAt: number): string {
  const ms = Math.max(0, revertAt - Date.now());
  const mins = Math.floor(ms / 60000);
  return `${mins}m`;
}

export function TemplateFirstPill({ mode, modeRevertAt, onToggleOff, onToggleOn }: Props) {
  if (mode === "TEMPLATE_FIRST_ON") {
    return (
      <button
        type="button"
        class="poseidon-pill poseidon-pill--on"
        onClick={onToggleOff}
        title="Click to turn off template-first mode for 30 minutes"
      >
        ✅ Template-first: ON
      </button>
    );
  }
  return (
    <button
      type="button"
      class="poseidon-pill poseidon-pill--off"
      onClick={onToggleOn}
      title="Click to turn template-first back on now"
    >
      ⚠️ Template-first: OFF (reverts in {modeRevertAt ? fmtRemaining(modeRevertAt) : "30m"})
    </button>
  );
}
