/**
 * STEP 4 — Test B · HARD STOP on no-match.
 *
 * Prompt simulated: "build me a Twitter clone".
 *
 * Asserts:
 *   - escape.no_template_match transitions phase to 'no_match_declared'.
 *   - screen.compose_from_atoms WITHOUT a designer confirmation is rejected.
 *   - screen.compose_from_atoms WITH a confirmation passes the gate.
 *   - Mid-stream tampering (skipping no-match) is blocked.
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  setNoMatchDeclared,
  assertNoMatchAndConfirmation,
  recordUserConfirmation,
  resetIdle,
} from "../../bridge/src/runtime/template-gate.ts";
import { _resetAll, getState } from "../../bridge/src/runtime/session-state.ts";
import { rankByIntent } from "../../bridge/src/runtime/template-index.ts";

const STREAM_ID = "test-b-stream";
const TWITTER_INTENT = "twitter clone with timeline and dms";

beforeEach(() => {
  _resetAll();
});

describe("Test B — HARD STOP · 'build me a Twitter clone'", () => {
  it("templates.suggest still returns candidates but none score high", () => {
    const candidates = rankByIntent(TWITTER_INTENT, 5);
    expect(candidates.length).toBe(5);
    expect(candidates[0].score).toBeLessThan(0.5);
  });

  it("escape.no_template_match with 3 considered + 40+ char rationale passes and sets phase='no_match_declared'", () => {
    const candidates = rankByIntent(TWITTER_INTENT, 5);
    const err = setNoMatchDeclared(
      STREAM_ID,
      TWITTER_INTENT,
      candidates.slice(0, 3),
      "Twitter timeline + DMs maps to a chat/social composition that isn't one of the 5 published page-template families.",
    );
    expect(err).toBeNull();
    expect(getState(STREAM_ID).phase).toBe("no_match_declared");
  });

  it("escape.no_template_match with <3 considered is rejected", () => {
    const candidates = rankByIntent(TWITTER_INTENT, 5);
    const err = setNoMatchDeclared(
      STREAM_ID,
      TWITTER_INTENT,
      candidates.slice(0, 2),
      "Trying to skip past the 3-considered requirement.",
    );
    expect(err).not.toBeNull();
    expect(err?.code).toBe("TEMPLATE_GATE_VIOLATION");
  });

  it("escape.no_template_match with sub-40 rationale is rejected", () => {
    const candidates = rankByIntent(TWITTER_INTENT, 5);
    const err = setNoMatchDeclared(
      STREAM_ID,
      TWITTER_INTENT,
      candidates.slice(0, 3),
      "too short",
    );
    expect(err).not.toBeNull();
    expect(err?.code).toBe("TEMPLATE_GATE_VIOLATION");
  });

  it("screen.compose_from_atoms WITHOUT no-match declaration is rejected", () => {
    const err = assertNoMatchAndConfirmation(STREAM_ID, "yes proceed");
    expect(err).not.toBeNull();
    expect(err?.details.nextRequiredTool).toBe("escape.no_template_match");
  });

  it("screen.compose_from_atoms after no-match but WITHOUT user confirmation is rejected", () => {
    const candidates = rankByIntent(TWITTER_INTENT, 5);
    setNoMatchDeclared(
      STREAM_ID,
      TWITTER_INTENT,
      candidates.slice(0, 3),
      "Twitter timeline + DMs maps to a chat/social composition that isn't published.",
    );
    const err = assertNoMatchAndConfirmation(STREAM_ID, "");
    expect(err).not.toBeNull();
    expect(err?.details.nextRequiredTool).toBe("ask_user");
  });

  it("screen.compose_from_atoms passes after no-match + designer confirmation", () => {
    const candidates = rankByIntent(TWITTER_INTENT, 5);
    setNoMatchDeclared(
      STREAM_ID,
      TWITTER_INTENT,
      candidates.slice(0, 3),
      "Twitter timeline + DMs maps to a chat/social composition that isn't published.",
    );
    recordUserConfirmation(STREAM_ID, "yes proceed");
    const err = assertNoMatchAndConfirmation(STREAM_ID, "yes proceed");
    expect(err).toBeNull();
  });

  it("after compose runs and resetIdle fires, the next screen starts at phase='idle'", () => {
    const candidates = rankByIntent(TWITTER_INTENT, 5);
    setNoMatchDeclared(
      STREAM_ID,
      TWITTER_INTENT,
      candidates.slice(0, 3),
      "Twitter timeline + DMs maps to a chat/social composition that isn't published.",
    );
    recordUserConfirmation(STREAM_ID, "yes proceed");
    assertNoMatchAndConfirmation(STREAM_ID, "yes proceed");
    resetIdle(STREAM_ID);
    expect(getState(STREAM_ID).phase).toBe("idle");
  });

  it("a mismatched confirmation answer is rejected (anti-spoof)", () => {
    const candidates = rankByIntent(TWITTER_INTENT, 5);
    setNoMatchDeclared(
      STREAM_ID,
      TWITTER_INTENT,
      candidates.slice(0, 3),
      "Twitter timeline + DMs maps to a chat/social composition that isn't published.",
    );
    recordUserConfirmation(STREAM_ID, "yes proceed");
    const err = assertNoMatchAndConfirmation(STREAM_ID, "no don't");
    expect(err).not.toBeNull();
    expect(err?.details.nextRequiredTool).toBe("ask_user");
  });
});
