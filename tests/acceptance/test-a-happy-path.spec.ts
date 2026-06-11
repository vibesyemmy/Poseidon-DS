/**
 * STEP 4 — Test A · Happy-path auto-match.
 *
 * Drives the gate state machine directly (no Claude, no Figma) so we can
 * deterministically assert the template-first sequence is enforced.
 *
 * Prompt simulated: "build me a transaction list".
 *
 * Run: pnpm --filter @poseidon/bridge test (after pnpm install).
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  setSuggested,
  setChosen,
  assertChosenMatching,
  resetIdle,
} from "../../bridge/src/runtime/template-gate.ts";
import { _resetAll, getState } from "../../bridge/src/runtime/session-state.ts";
import {
  rankByIntent,
  getByVariantKey,
} from "../../bridge/src/runtime/template-index.ts";

const STREAM_ID = "test-a-stream";

beforeEach(() => {
  _resetAll();
});

describe("Test A — happy path · 'build me a transaction list'", () => {
  it("starts at phase=idle", () => {
    expect(getState(STREAM_ID).phase).toBe("idle");
  });

  it("templates.suggest ranks the List family at the top", () => {
    const candidates = rankByIntent("build me a transaction list", 5);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].family).toBe("List");
    expect(candidates[0].variantKey).toBe("page.list.tabs_and_table");
  });

  it("templates.suggest moves phase to 'suggested' and records lastSuggestion", () => {
    const candidates = rankByIntent("build me a transaction list", 5);
    setSuggested(STREAM_ID, "transaction list", candidates);
    const s = getState(STREAM_ID);
    expect(s.phase).toBe("suggested");
    expect(s.lastSuggestion?.intent).toBe("transaction list");
    expect(s.lastSuggestion?.variants.length).toBe(candidates.length);
  });

  it("templates.choose locks the variant and moves phase to 'chosen'", () => {
    const candidates = rankByIntent("build me a transaction list", 5);
    setSuggested(STREAM_ID, "transaction list", candidates);
    const err = setChosen(
      STREAM_ID,
      "page.list.tabs_and_table",
      "Designer wants to browse transactions with channel tab filtering — exact Use-when match.",
    );
    expect(err).toBeNull();
    const s = getState(STREAM_ID);
    expect(s.phase).toBe("chosen");
    expect(s.choice?.variantKey).toBe("page.list.tabs_and_table");
  });

  it("screen.from_template with matching variant passes the gate", () => {
    const candidates = rankByIntent("build me a transaction list", 5);
    setSuggested(STREAM_ID, "transaction list", candidates);
    setChosen(
      STREAM_ID,
      "page.list.tabs_and_table",
      "Designer wants to browse transactions with channel tab filtering — exact Use-when match.",
    );
    const err = assertChosenMatching(STREAM_ID, "page.list.tabs_and_table");
    expect(err).toBeNull();
  });

  it("after screen.from_template renders, phase resets to 'idle' for the next screen", () => {
    const candidates = rankByIntent("build me a transaction list", 5);
    setSuggested(STREAM_ID, "transaction list", candidates);
    setChosen(STREAM_ID, "page.list.tabs_and_table", "Reason long enough for the gate to accept.");
    assertChosenMatching(STREAM_ID, "page.list.tabs_and_table");
    resetIdle(STREAM_ID);
    expect(getState(STREAM_ID).phase).toBe("idle");
  });

  it("getByVariantKey returns the registry entry for the chosen variant", () => {
    const v = getByVariantKey("page.list.tabs_and_table");
    expect(v).not.toBeNull();
    expect(v?.recipeSlug).toBe("list-page-with-tabs-and-table");
    expect(v?.name).toBe("List page · With tabs and table");
  });
});

describe("Test A — illegal transitions are blocked", () => {
  it("templates.choose without prior templates.suggest is rejected", () => {
    const err = setChosen(STREAM_ID, "page.list.tabs_and_table", "20+ chars long enough reason.");
    expect(err).not.toBeNull();
    expect(err?.code).toBe("TEMPLATE_GATE_VIOLATION");
    expect(err?.details.nextRequiredTool).toBe("templates.suggest");
  });

  it("templates.choose with a variantKey not in the suggestion is rejected", () => {
    const candidates = rankByIntent("build me a transaction list", 5);
    setSuggested(STREAM_ID, "transaction list", candidates);
    const err = setChosen(
      STREAM_ID,
      "page.form.wizard",
      "Picking a variant not in the suggestion.",
    );
    expect(err).not.toBeNull();
    expect(err?.details.nextRequiredTool).toBe("templates.suggest");
  });

  it("templates.choose with a sub-20-char reason is rejected", () => {
    const candidates = rankByIntent("build me a transaction list", 5);
    setSuggested(STREAM_ID, "transaction list", candidates);
    const err = setChosen(STREAM_ID, "page.list.tabs_and_table", "too short");
    expect(err).not.toBeNull();
    expect(err?.details.nextRequiredTool).toBe("templates.choose");
  });

  it("screen.from_template without prior templates.choose is rejected", () => {
    const err = assertChosenMatching(STREAM_ID, "page.list.tabs_and_table");
    expect(err).not.toBeNull();
    expect(err?.details.nextRequiredTool).toBe("templates.choose");
  });

  it("screen.from_template with a mismatched variantKey is rejected", () => {
    const candidates = rankByIntent("build me a transaction list", 5);
    setSuggested(STREAM_ID, "transaction list", candidates);
    setChosen(STREAM_ID, "page.list.tabs_and_table", "Reason long enough for the gate to accept.");
    const err = assertChosenMatching(STREAM_ID, "page.list.kpis_and_table");
    expect(err).not.toBeNull();
    expect(err?.details.nextRequiredTool).toBe("templates.choose");
  });
});
