---
name: screen-patterns
description: Empty / error / loading states, wizards, forms, modals, confirmations. Use when the designer mentions a state that isn't the happy path, or any multi-step / multi-state flow.
when-to-use: Empty states, error states, loading skeletons, wizards, forms, modals, confirmations.
---

# Screen patterns

## States every list/detail screen needs

1. **Happy path** — populated, normal.
2. **Empty** — first run, no data yet. Use Hydrogen `EmptyState` (key in components.json) with title + body + primary CTA telling user what to do.
3. **Loading** — skeleton placeholders matching final layout, not spinners. Spinner only for inline actions < 1s expected.
4. **Error** — clear message + retry. Don't dead-end.
5. **Permission** — if the user can't see this data, explain why with no scary language.

Always design states 2–4 alongside state 1. If you only have state 1, the screen isn't done.

## Forms

- One concept per screen on mobile. Group fields by concept on desktop.
- Top-aligned labels (not left). Faster scanning + no width juggling.
- Inline validation on blur, not on every keystroke. Show success state only when verifying (e.g. email checks).
- Disabled primary CTA until form is valid — but say *why* it's disabled (microcopy near button or below).
- Errors summarize at top of form when ≥ 3 invalid fields. Otherwise inline only.

## Wizards (multi-step)

- Show step indicator: "Step 2 of 4" + step names.
- Persistent Back + Continue (never just Continue).
- Validate the current step before letting them advance.
- Don't gate the whole flow on one optional field.

## Modals

- For decisions, not navigation. If the user needs the rest of the screen to decide, it shouldn't be a modal.
- Cancel left, primary right. Destructive primary uses error fill.
- Click-outside-to-dismiss only for non-destructive.
- Body explains the consequence. Title states the action. Button confirms it.

## Confirmations

- Required for: delete (anything), send (irreversible), publish, leave-without-saving.
- Not required for: archive (reversible), draft saves, hide.
- Two-step typing confirm for catastrophic actions ("type DELETE to confirm").

## Loading

- Skeletons match final shape (same heights, same number of items where possible).
- After 3s, show "Still loading…" microcopy. After 10s, offer a retry button or surface the error.
