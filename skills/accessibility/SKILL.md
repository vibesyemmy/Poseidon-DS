---
name: accessibility
description: WCAG AA contrast, touch targets, focus visibility, motion-safety, non-color signals. Use whenever choosing colors, sizing interactive elements, or finalizing a screen.
when-to-use: Any color choice, interactive element sizing, status/error indicators, motion or animation.
---

# Accessibility

## Contrast (WCAG AA, baseline)

| Text role | Minimum ratio |
|---|---|
| Body text (< 18pt) | 4.5:1 |
| Large text (≥ 18pt regular or ≥ 14pt bold) | 3:1 |
| Non-text UI (icons, focus rings, borders carrying meaning) | 3:1 |

Hydrogen's `color/text/01` ↔ `color/special/background/page-bg` is AA-compliant in both modes. If composing custom pairs, eyeball + run `get_variables` to confirm the variable's resolved RGB.

## Touch targets

- Minimum 44 × 44 px hit area on mobile breakpoint. Visible button may be smaller (e.g. 32×32 icon button) as long as padding/hit-region brings the touchable area up.
- Spacing between adjacent targets ≥ 8 px to avoid mistaps.

## Focus

- Every interactive element needs a visible focus state. Hydrogen Button variants include a Focus state — use it.
- Don't rely on `outline: none`. Don't use color alone for focus (must include outline width or offset).

## Status & error signaling

- Color is never the only signal. Pair every status with:
  - an icon (success ✓, warning ⚠, error ✕, info ℹ)
  - a text label or microcopy
- Don't say "the red ones" — say "the failed payments".

## Motion

- Honor `prefers-reduced-motion`. Avoid auto-playing carousels, parallax, large translateY transitions.
- Tooltips fade ≤ 100ms; modals fade ≤ 200ms. No spinning loaders longer than 1s without progress text.

## Forms

- Every input needs a visible label, not just placeholder. Placeholders disappear on focus.
- Errors below the field, in `color/status/error/fill`, with the field's border switched to the same.
- Required fields marked with text "Required" — not just `*`.
