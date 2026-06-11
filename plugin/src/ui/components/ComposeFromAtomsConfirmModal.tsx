/**
 * STEP 3 — ComposeFromAtomsConfirmModal
 *
 * Designer must either:
 *   - Type literal "CONFIRM" to enable Proceed, OR
 *   - Wait 5s for Proceed to enable automatically.
 *
 * Copy escalates after the 3rd override in a session.
 */

import { useEffect, useState } from "preact/hooks";

interface Props {
  overrideCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

const DELAY_MS = 5000;

export function ComposeFromAtomsConfirmModal({ overrideCount, onConfirm, onCancel }: Props) {
  const [typed, setTyped] = useState("");
  const [delayElapsed, setDelayElapsed] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDelayElapsed(true), DELAY_MS);
    return () => clearTimeout(t);
  }, []);

  const enabled = typed.trim() === "CONFIRM" || delayElapsed;
  const escalated = overrideCount >= 3;

  return (
    <div class="poseidon-modal-overlay">
      <div class="poseidon-modal poseidon-compose-confirm">
        <h2>Compose from atoms — are you sure?</h2>
        <p>
          {escalated
            ? "This is your 4th template-skip in this session. Each override widens the gap between this surface and the rest of the design system. Strongly reconsider."
            : "Composing skips the published template registry. Future template updates won't reach this screen. Atoms (Button, Input, Badge, …) will still receive updates, but the page chrome you build now is frozen."}
        </p>
        <p>
          Type <code>CONFIRM</code> below, or wait {Math.ceil(DELAY_MS / 1000)}s, to enable Proceed.
        </p>
        <input
          type="text"
          autofocus
          value={typed}
          onInput={(e) => setTyped((e.target as HTMLInputElement).value)}
          placeholder="CONFIRM"
          class="poseidon-input"
        />
        <footer class="poseidon-modal__actions">
          <button type="button" onClick={onCancel} class="poseidon-btn">
            Cancel
          </button>
          <button
            type="button"
            disabled={!enabled}
            onClick={onConfirm}
            class={`poseidon-btn poseidon-btn--danger ${enabled ? "" : "is-disabled"}`}
          >
            {enabled ? "Proceed" : "Proceed (wait or type CONFIRM…)"}
          </button>
        </footer>
      </div>
    </div>
  );
}
