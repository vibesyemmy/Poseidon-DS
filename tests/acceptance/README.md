# Acceptance Tests — STEP 4 of ENFORCEMENT.md

Two scripted sessions that prove the L1 + L2 + L3 enforcement layers work end-to-end.

## What's tested

| Test | Prompt | Expected outcome |
|---|---|---|
| **A — happy path** | _"build me a transaction list"_ | `templates.suggest` → `templates.choose` → `screen.from_template` runs; single `figma.commitUndo()` boundary; audit log shows `accept`. |
| **B — HARD STOP** | _"build me a Twitter clone"_ | `templates.suggest` + `escape.no_template_match` fire; `ask_user` pauses; `screen.compose_from_atoms` REJECTED with `TEMPLATE_GATE_VIOLATION` until designer authorizes. |

Both tests must pass before any layer is declared production-ready.

## How to run

### Unit-level (deterministic, no Claude / Figma)

The gate state machine is testable in isolation:

```bash
cd bridge
pnpm install
pnpm test
```

This runs `bridge/tests/template-gate.spec.ts` (and the acceptance specs below
that import the gate primitives directly). They simulate the tool sequence
and assert each phase transition + every illegal transition returns
`TEMPLATE_GATE_VIOLATION` with the correct `nextRequiredTool`.

### End-to-end (manual, requires running bridge + plugin + Figma)

1. Open the Hydrogen DS file in Figma Desktop with the Figma Desktop Bridge
   plugin running (see root README).
2. Open Poseidon: `Plugins → Development → Poseidon`.
3. Start the bridge: `pnpm bridge:dev` from the repo root.
4. Run each test below in a fresh chat session.

#### Test A — happy path

Prompt: `build me a transaction list`

Expected stream of events (Network tab or audit.jsonl):

1. Assistant turn opens with `Template check: transaction list -> page.list.tabs_and_table`.
2. `templates_suggest({ intent: "transaction list" })` returns ≥1 variant in family `List`.
3. `templates_choose({ variantKey: "page.list.tabs_and_table", reason: "..." })` passes gate.
4. UI shows `MatchedTemplateCard` with Accept default-focused.
5. On Accept, `screen_from_template` runs, single `figma.commitUndo()` boundary, screen renders.
6. `~/.poseidon/audit.jsonl` gains a `gate_decision` entry with `phase_after: "idle"` and a `ui_audit` entry with `decision: "accept"`.

**PASS criterion:** no hand-composed atoms, no `emit_recipe`, undo reverts in one Cmd+Z.

#### Test B — HARD STOP on no-match

Prompt: `build me a Twitter clone`

Expected:

1. Assistant turn opens with `Template check: twitter clone -> none`.
2. `templates_suggest` returns 5 candidates, all with `score < 0.3`.
3. `escape_no_template_match({ considered: [≥3 variants], rationale: "..." })` fires.
4. Tool-gate sets `phase='no_match_declared'`, returns `{ mustAskUser: true }`.
5. `ask_user` pauses the stream; UI shows `NoMatchCard` with 3 chips.
6. Without user action, `screen_compose_from_atoms` is REJECTED by the gate with
   `TEMPLATE_GATE_VIOLATION { nextRequiredTool: 'ask_user' }`.
7. Designer clicks `Compose from atoms` → `ComposeFromAtomsConfirmModal` requires typing `CONFIRM` or waiting 5s.
8. Designer types `CONFIRM` → `screen_compose_from_atoms({ userConfirmation: "CONFIRM", ... })` passes.

**PASS criterion:** no Figma mutation occurs before the designer authorizes. Audit log shows `phase=no_match_declared` then `compose_override`. Designer sees no-match dialog.

## Reading the audit log

```bash
tail -f ~/.poseidon/audit.jsonl | jq .
```

Filter by kind:

```bash
jq -s 'group_by(.kind) | map({kind: .[0].kind, count: length})' ~/.poseidon/audit.jsonl
```

Per-session traces:

```bash
jq 'select(.conversationId == "<streamId>")' ~/.poseidon/audit.jsonl
```
