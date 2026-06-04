---
name: copywriting
description: Microcopy, button labels, error tone, empty-state voice. Use when picking labels, writing toasts, errors, empty states, or any UI text. The right word saves a redesign.
when-to-use: Any text the user will read in the product — labels, messages, copy, names.
---

# Copywriting

## Voice

- **Plain. Direct. Brief.** Cut adjectives. Cut adverbs.
- Active voice. "You saved" not "Has been saved".
- Sentence case for labels and buttons. Title Case for proper nouns and page titles only.
- Avoid jargon unless designer is in a power-user surface (admin, dev tools).

## Buttons

- Verb + noun. "Save changes", "Send invite", "Cancel order".
- Never bare verbs: "Save" alone is ambiguous → "Save draft" / "Save & close".
- Destructive: name the thing being destroyed: "Delete invoice" not "Delete".
- Primary button = the most likely / safe action. Destructive primaries get a confirm step.

## Errors

- State the problem + the fix in one sentence.
- "Email is required" ✓ — "Please fill in the email field" ✗
- "We couldn't reach the server. Retry in a moment." ✓
- Don't blame the user: "Invalid input" → "We don't recognize that format. Try `name@company.com`."

## Empty states

- One sentence telling them what this surface is for + one action they can take.
- "No invoices yet" + button "Create your first invoice".
- Don't apologize for emptiness. Don't be cheerful in a context where it's wrong (errors, deletions, churn).

## Status / toasts

- Past tense for completed actions: "Saved" not "Save successful".
- Don't toast for trivia. Toast for: write completed (Save, Send), undoable destructive (Deleted — Undo), error.
- Toast text ≤ 60 chars. If it needs more, use a banner or modal.

## Numbers

- Currency: always with symbol + locale grouping. `₦1,250` not `1250 naira`.
- Times: relative for recent ("2 min ago"), absolute for old (dates).
- Plurals: "1 item" / "5 items". Use the actual number, not "many" or "a few".
