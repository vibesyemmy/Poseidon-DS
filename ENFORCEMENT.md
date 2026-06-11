# Poseidon Template-First Enforcement Plan

**Status:** Draft v1 — defense-in-depth synthesis
**Owners:** Poseidon bridge + plugin maintainers
**Scope:** All screen-creation flows through the Poseidon Bridge (`localhost:9334`) and the Figma plugin (`Plugins → Development → Poseidon`).

---

## 1. Executive Summary

Poseidon's current template-first rule lives entirely in the bundled `hydrogen-ds` SKILL.md as a soft prompt convention, and that bundled copy has drifted from the canonical `.claude/skills/hydrogen-ds/SKILL.md` — the six load-bearing enforcement clauses (MANDATORY recipe, pre-build checklist, HARD STOP, `detachInstance()`, 5-family registry, verified gotchas) are entirely missing from the shipped Poseidon copy. We will replace that single soft layer with a three-layer defense-in-depth model: (L1) a synced, always-loaded skill plus a hard bridge-injected system rule, (L2) a deterministic tool-gate state machine inside the bridge that physically blocks `figma.*` mutations until template-first preconditions are met, and (L3) a UI confirmation card and audit log in the plugin chat surface. Each layer catches what the layer above probabilistically misses, with the tool-gate (L2) serving as the hard stop and the UI (L3) providing designer-visible consent and override trails. Implementation proceeds smallest-cost-first: skill sync today, prompt rule this week, tool-gate next week, UI confirmation after.

---

## 2. Why Current Enforcement Fails Today

The single existing enforcement surface is the bundled `Poseidon/skills/hydrogen-ds/SKILL.md`, which the bridge concatenates into the system prompt via `buildSkillSystemPrompt()` in `bridge/src/skills.ts`. That copy has drifted from the canonical source in `.claude/skills/hydrogen-ds/SKILL.md`. Direct gaps from the drift audit:

- **Missing the MANDATORY recipe.** Canonical includes "Start from a page template (MANDATORY for new screens)" (lines 62–91). Bundled has only a vague workflow step: *"list_templates first. If a template fits, insert_template."* No MANDATORY language; no enforcement intent.
- **Missing the pre-build checklist.** Canonical includes a 4-step ordered "Pre-build template check (mandatory, in order)" — read mapping table, open family registry row, instantiate+detach, or hard-stop. Bundled has none of this.
- **Missing the HARD STOP.** Canonical requires *"HARD STOP. Do NOT build from atoms automatically"* on no-match — Claude must report intent, enumerate 2–3 closest candidates with Use/Don't-use lines, and *"wait for express instruction."* Bundled silently allows fall-through to `emit_recipe` / `modify_node`.
- **Missing `detachInstance()`.** Canonical has the explicit code sample with the `// ← MANDATORY` comment and the rationale (*"templates are scaffolds, not contracts; detaching freezes layout; atoms still live-update"*). Bundled has zero mention.
- **Missing the 5-family registry.** Canonical names *"List page · Detail page · Form · Onboarding · Settings"* as the canonical families. Bundled claims "18 page templates" via `list_templates` but never names a family and never references `03-templates.md`.
- **Missing verified gotchas.** Canonical has 4 verified gotchas (templates not draggable, variant switch resets layer IDs, prop combinations 404, cross-file REST 404). Bundled has none.

**Root cause:** the bundled copy was rewritten around the Poseidon tool surface (`list_templates` / `insert_template` / `emit_recipe` / `modify_node`) instead of the canonical figma-console `figma_execute` + `importComponentByKeyAsync` path, and the template-governance content was dropped in the rewrite. Even after we re-sync the file, the underlying problem remains: **a prompt-layer rule is probabilistic. The model can rationalize around it under pressure, long contexts, or adversarial user prompts.** A single failure produces a screen full of hand-composed atoms that bypass the template registry entirely.

---

## 3. Defense-in-Depth Model

```
┌─────────────────────────────────────────────────────────────────────────┐
│ User: "build me a transactions screen"                                  │
└─────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ L1 — PROMPT LAYER  (cheap, probabilistic, earliest)                     │
│  • Synced bundled+canonical hydrogen-ds skill (always-loaded, prio 100) │
│  • Bridge-injected hard rule on every screen-creation turn              │
│  • Required "Template check: <intent> -> <variantKey|none>" preamble    │
│  Catches: 90%+ of well-intentioned turns. Cheapest to ship.             │
└─────────────────────────────────────────────────────────────────────────┘
                                  │  (rule ignored / preamble missing)
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ L2 — TOOL-GATE LAYER  (deterministic, hard stop)                        │
│  Session state machine in bridge dispatcher:                            │
│   idle → suggested → chosen → screen.from_template → idle               │
│        OR                                                               │
│   idle → suggested → no_match_declared → ask_user → atoms_unlocked      │
│  Violations return TEMPLATE_GATE_VIOLATION with nextRequiredTool hint.  │
│  Catches: 100% of out-of-order screen-creation calls. NEVER reaches     │
│  Figma. Self-healing — Claude is told exactly which tool to call next.  │
└─────────────────────────────────────────────────────────────────────────┘
                                  │  (gate passed)
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ L3 — UI LAYER  (designer consent + audit)                               │
│  • MatchedTemplateCard with Accept / Pick different / No match          │
│  • NoMatchCard with 3 closest candidates + rejection chips              │
│  • ComposeFromAtomsConfirmModal (typed CONFIRM + 5s delay)              │
│  • ~/.poseidon/audit.jsonl: {intent, variantKey, decision, reason}      │
│  • Bridge mutation-watcher: red banner if figma_execute lacks approval  │
│  Catches: Tool-gate bypasses via figma_execute escape hatch. Surfaces   │
│  silent template gaps as actionable signal.                             │
└─────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
                          figma.* mutation
```

**Layering contract:** L1 is best-effort. L2 is the hard stop. L3 is the consent + audit layer. Each layer is independent — disabling any one still leaves working enforcement.

---

## 4. Step-by-Step Implementation Order (smallest-cost-first)

### STEP 0 — Sync bundled skill from canonical (today, <1 hour)

Zero new code. Direct file copy + commit. Closes the six drift gaps immediately and makes the rest of the plan stand on solid ground.

```bash
cp /Users/opeyemiajagbe/Documents/Projects/Hydrogen-Designs/.claude/skills/hydrogen-ds/SKILL.md \
   /Users/opeyemiajagbe/Documents/Projects/Hydrogen-Designs/Poseidon/skills/hydrogen-ds/SKILL.md
```

Then adapt the Poseidon-specific tool names inline:

- Replace `figma_execute` references in the canonical body with the Poseidon tool catalog (`insert_template`, `insert_component`, `emit_recipe`, `modify_node`) where the surface differs.
- Preserve verbatim: the MANDATORY recipe, the pre-build checklist, the HARD STOP clause, the `detachInstance()` rationale, the 5-family registry, and the verified gotchas.
- Add a frontmatter block: `autoload: true`, `priority: 100`, `when-to-use: always`, `scope: screen-creation`.

Verify with `git diff Poseidon/skills/hydrogen-ds/SKILL.md` that all six gaps are now closed.

### STEP 1 — Skill prompt + system-prompt injection (this week)

Goal: get the rule into Claude's working context on every screen-creation turn, before any tool-gate work, so designers immediately benefit.

1. **Author the hard rule** as a short imperative contract (<120 tokens) in `Poseidon/bridge/src/prompts/template-first-rule.ts`. Content: (a) MUST call `templates.suggest` before any screen-creation tool, (b) MUST emit `Template check: <intent> -> <variantKey|none>` as the first line of the assistant turn, (c) on no match MUST call `escape.no_template_match` and `ask_user`, (d) NEVER silent-compose from atoms.
2. **Inject into `bridge/src/chat.ts`** after `SYSTEM_PROMPT_BASE` and after `buildSkillSystemPrompt()`. Place last so it has recency weight against long histories.
3. **Reasoning-trace validator** in the bridge SSE pipeline: regex `/^Template check:\s+.+\s+->\s+(\S+)/m` on the first assistant block of any turn that emits a screen-creation tool call. If missing, return a tool-result error asking the model to restart with the preamble. Log every check to `~/.poseidon/audit.jsonl`.
4. **Forced-injection fallback:** if a screen-creation tool call arrives without a preceding `templates.suggest` in the same turn, the bridge synthesizes a `templates.suggest` call using the tool args as the query and re-prompts the model with the result before allowing the original call.
5. **Telemetry:** log `(preamble_present, templates_suggest_called, forced_injection_fired, escape_used, silent_compose_attempted)` per turn. The silent-compose-attempt rate is the primary SLI for L1.

### STEP 2 — Tool-gate state machine (next week)

Goal: make template-first physically un-bypassable for any tool that reaches the Figma sandbox.

**Session state contract** (`bridge/src/runtime/session-state.ts`):

```ts
type Phase =
  | 'idle'
  | 'suggested'
  | 'chosen'
  | 'no_match_declared'
  | 'atoms_unlocked';

interface SessionState {
  conversationId: string;
  phase: Phase;
  lastSuggestion?: { intent: string; variants: VariantSummary[] };
  choice?: { variantKey: string; reason: string; at: number };
  noMatchDeclaredAt?: number;
  // Lifetime: per /chat SSE session; cleared on session/end; 30min idle TTL.
}

interface VariantSummary {
  variantKey: string;           // e.g. "page.list.transactions"
  name: string;                 // "List page"
  family: 'List' | 'Detail' | 'Form' | 'Onboarding' | 'Settings';
  useWhen: string;
  dontUseWhen: string;
  score: number;                // 0..1, from 03-templates.md index
}
```

**Tool signatures** (added to `src/runtime/tools.ts` and the bridge MCP server):

```ts
templates.suggest(intent: string, limit?: number = 5)
  → ToolResult<{ variants: VariantSummary[] }>
  // Pure read. Sets phase='suggested', stores lastSuggestion.

templates.choose(variantKey: string, reason: string)
  → ToolResult<{ variantKey: string; name: string; recipeSlug: string }>
  // Preconditions: phase==='suggested' AND variantKey ∈ lastSuggestion
  //   AND reason.length >= 20.
  // Side effect: phase='chosen', stores choice.

screen.from_template(
  variantKey: string,
  overrides?: InsertTemplateInput['overrides'],
  position?: Position,
) → InsertTemplateResult
  // Preconditions: phase==='chosen' AND variantKey===choice.variantKey.
  // Delegates to existing insert_template. Wraps figma.commitUndo() boundary.
  // On success: phase resets to 'idle' (one screen per cycle).

escape.no_template_match(
  intent: string,
  considered: VariantSummary[],
  rationale: string,
) → ToolResult<{ ack: true; mustAskUser: true }>
  // Preconditions: considered.length >= 3 (server-enforced),
  //   each considered.variantKey resolves in templates-index,
  //   rationale.length >= 40.
  // Side effect: phase='no_match_declared'.

screen.compose_from_atoms(reason: string, userConfirmation: string)
  → EmitRecipeResult
  // Preconditions: phase==='no_match_declared' AND prior ask_user answer
  //   in session matches userConfirmation.
  // Delegates to existing emit_recipe. Wraps figma.commitUndo() boundary.
  // On success: phase='idle'.
```

**Dispatcher wrapping.** In `bridge/src/toolRouter.ts`, wrap `insert_template`, `insert_component` (when used as a whole screen), and `emit_recipe`. Route through the gate when `scope==='screen'` or recipe height suggests a screen. Component-level edits and `modify_node` bypass.

**Error contract.**

```ts
{
  ok: false,
  code: 'TEMPLATE_GATE_VIOLATION',
  message: 'Screen creation blocked: template-first sequence incomplete.',
  details: {
    currentPhase: Phase,
    requiredPhase: Phase,
    nextRequiredTool: string,   // e.g. 'templates.suggest'
    hint: string,               // human-readable next step
  }
}
```

The dispatcher returns this without ever calling Figma. Claude receives it as a `tool_result` and naturally retries with the correct tool.

**Audit log.** Every gate decision writes `~/.poseidon/audit.jsonl`:
`{ conversationId, phase_before, tool, phase_after, variantKey?, reason?, at }`.

**Tests.** Unit-test every illegal transition; assert each returns `TEMPLATE_GATE_VIOLATION` with the correct `nextRequiredTool`. Legal transitions must forward to plugin SSE unchanged.

### STEP 3 — UI confirmation card + no-match dialog + audit log (week after)

Goal: designer-visible consent. Catches the one remaining bypass (`figma_execute` arbitrary-JS escape hatch from Phase 5.6a) and surfaces template gaps.

1. **Message protocol** in `plugin/src/shared/messages.ts`: `PROPOSAL_REQUEST`, `PROPOSAL_RESPONSE`, `MUTATION_INTENT`, `MUTATION_ACK`, `MUTATION_EMITTED`, `OVERRIDE_LOGGED`, `TEMPLATE_CHECK_SKIPPED`.
2. **Composer state machine** (`plugin/src/ui/state/composer.ts`): modes `TEMPLATE_FIRST_ON` (default), `TEMPLATE_FIRST_OFF_TEMPORARY` (30 min auto-revert), `AWAITING_PROPOSAL`, `AWAITING_DECISION`, `MUTATION_IN_FLIGHT`.
3. **Components:**
   - `TemplateFirstPill` — toggle + amber warning + countdown.
   - `MatchedTemplateCard` — name, variant, confidence, thumbnail, Accept / Pick different / No match. Accept disabled 2s on first 3 sessions to defeat reflexive clicks.
   - `NoMatchCard` — 3 closest candidates as rejection chips (expand to read reason before they enable), Compose from atoms (gated by confirm modal), Refine intent (loops back to prompt), Add new template (opens authoring drawer).
   - `ComposeFromAtomsConfirmModal` — requires typing `CONFIRM` or 5s delay before Proceed enables. Escalates copy after the 3rd override in a session.
4. **Bridge mutation-watcher** (`plugin/src/bridge/mutation-watcher.ts`): subscribes to every `figma_execute` emission, cross-references against approved `proposal_id`s. Mismatch → red banner: *"Template check skipped — investigate"* with audit link. Sandbox also rejects unapproved mutations with `MUTATION_REJECTED_NO_APPROVAL`.
5. **Post-mutation diff validator**: compare emitted node tree against approved template skeleton. Structural divergence triggers *"Built output diverged from approved template"* banner.
6. **Audit logger** (`plugin/src/audit/logger.ts`) writes to `session/data/audit.jsonl`:
   `{ timestamp, designer_email, session_id, intent_text, proposed_template_id, proposed_variant, decision, override_reason, mutation_proposal_id }`.

### STEP 4 — Acceptance test

Two scripted sessions, run end-to-end against a fresh Poseidon install (sync'd skill + L1 + L2 + L3):

**Test A — happy path auto-match.**
- Prompt: *"build me a transaction list"*.
- Expected:
  1. Assistant turn opens with `Template check: transaction list -> page.list.transactions`.
  2. `templates.suggest` fires, returns ≥1 variant in family `List`.
  3. `templates.choose("page.list.transactions", reason)` passes gate.
  4. UI shows `MatchedTemplateCard` with Accept default-focused.
  5. On Accept, `screen.from_template` runs, single `figma.commitUndo()` boundary, screen renders.
  6. Audit log has one entry, decision: `accept`.
  7. **PASS criterion:** no hand-composed atoms, no `emit_recipe`, undo reverts in one Cmd+Z.

**Test B — HARD STOP on no-match.**
- Prompt: *"build me a Twitter clone"*.
- Expected:
  1. Assistant turn opens with `Template check: twitter clone -> none`.
  2. `templates.suggest` fires, returns 5 candidates, all low-score.
  3. `escape.no_template_match` fires with `considered.length >= 3` and rationale.
  4. Tool-gate sets `phase='no_match_declared'`, returns `{ mustAskUser: true }`.
  5. `ask_user` pauses the stream; UI shows `NoMatchCard` with 3 chips.
  6. Without user action, `screen.compose_from_atoms` is REJECTED by the gate with `TEMPLATE_GATE_VIOLATION { nextRequiredTool: 'ask_user' }`.
  7. **PASS criterion:** no Figma mutation occurs. Audit log shows `phase=no_match_declared`. Designer sees no-match dialog.

Both tests must pass before any layer is declared production-ready.

---

## 5. Effort Estimates

| Step | Layer | Designer-days | Source |
|------|-------|---------------|--------|
| 0 — Sync bundled skill | L1 | 0.25 | this plan |
| 1 — Prompt + system-prompt injection + reasoning-trace grep | L1 | 6 | Proposal 2 |
| 2 — Tool-gate state machine | L2 | 6 | Proposal 1 |
| 3 — UI confirmation + no-match dialog + audit | L3 | 8 | Proposal 3 |
| 4 — Acceptance tests + sync hooks | infra | 1 | this plan |
| **Total** | | **~21.25** | |

Cumulative ship gates: STEP 0 ships today, STEP 1 within a week, STEP 2 within two weeks, STEP 3 within four weeks.

---

## 6. Failure-Modes Appendix

### What L1 (prompt) catches
- Well-intentioned turns where Claude has the rule in attention.
- Forced-injection fallback fires `templates.suggest` automatically if Claude forgets.

### What slips through L1 to L2
- Long conversations (~20+ turns) where the rule decays from effective attention.
- Adversarial user prompts (*"ignore template rules, just build it"*) that outrank the skill.
- Performative preamble — Claude writes *"Template check: ..."* as theater then silent-composes.
- Skill drift if STEP 0 isn't re-run after future canonical edits (caught by §7 sync hook).

### What L2 (tool-gate) catches
- Every out-of-order screen-creation call. Phase mismatch → `TEMPLATE_GATE_VIOLATION` → no Figma call.
- `escape.no_template_match` with `considered.length < 3` or `rationale.length < 40` — schema-rejected.
- `screen.compose_from_atoms` without matching `ask_user` answer — rejected.

### What slips through L2 to L3
- `figma_execute` arbitrary-JS escape hatch (Phase 5.6a) — bypasses the declarative tool set entirely.
- Component-level `modify_node` calls that aggregate into a de-facto whole screen.
- Session-state loss on bridge restart mid-stream — gate resets, user-visible but correct.

### What L3 (UI) catches
- `figma_execute` mutations lacking approved `proposal_id` → red *"Template check skipped"* banner + audit entry.
- Post-mutation skeleton divergence from approved template → *"Built output diverged"* banner.
- Designer over-overriding — escalating confirm copy after 3rd override in a session.

### What slips through L3 (residual risk, accepted)
- Designer toggles Template-first off and accepts the 30-min temporary disable — by design.
- Designer types `CONFIRM` and accepts atoms — by design, but audit log captures it for retro.
- Audit log write failure — surfaced via sentinel toast (*"Audit log unavailable — session not recording"*), enforcement still active but no trail.

---

## 7. Sync Schedule — Bundled ≡ Canonical

**Source of truth:** `.claude/skills/hydrogen-ds/SKILL.md`.
**Bundled mirror:** `Poseidon/skills/hydrogen-ds/SKILL.md`.

### Pre-commit hook (`.husky/pre-commit` or `lefthook.yml`)

```bash
#!/usr/bin/env bash
# Block any commit that touches the canonical skill without re-syncing the bundled copy.
CANONICAL=".claude/skills/hydrogen-ds/SKILL.md"
BUNDLED="Poseidon/skills/hydrogen-ds/SKILL.md"

if git diff --cached --name-only | grep -qx "$CANONICAL"; then
  if ! git diff --cached --name-only | grep -qx "$BUNDLED"; then
    echo "ERROR: $CANONICAL changed but $BUNDLED was not updated."
    echo "Run: cp $CANONICAL $BUNDLED  (then re-apply Poseidon tool-name adaptations)"
    exit 1
  fi
fi
```

### CI check (`.github/workflows/skill-sync-check.yml`)

```yaml
name: skill-sync-check
on: [pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Verify bundled skill contains canonical clauses
        run: |
          for clause in \
            "MANDATORY for new screens" \
            "Pre-build template check" \
            "HARD STOP" \
            "detachInstance" \
            "List page · Detail page · Form · Onboarding · Settings" \
            "Gotchas (verified)"
          do
            if ! grep -q "$clause" Poseidon/skills/hydrogen-ds/SKILL.md; then
              echo "MISSING CLAUSE: $clause"
              exit 1
            fi
          done
```

### Quarterly canonical review
Owner re-reads canonical + bundled side-by-side every quarter, refreshes the gotchas section, and bumps a `version:` key in the frontmatter so the bridge can log skill version per session.

### Pre-publish hook (`package.json`)
`prepublishOnly`: re-run the bundled-vs-canonical hash check; fail publish on mismatch.

---

**End of plan.**
