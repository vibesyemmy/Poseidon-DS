---
name: hydrogen-ds
description: Hydrogen Design System reference — non-negotiable rules, token shorthand, and how to discover components/styles/variables at runtime. Use on any request that builds, modifies, or inspects UI on a Hydrogen surface.
when-to-use: Always — every UI-building turn.
---

# Hydrogen Design System

## Non-negotiable rules

1. Never use raw hex values in recipes when a token exists. Reference tokens like `color/text/01`, `color/primary/default`, `spacing/medium`, `radius/regular`. Raw hex only for stubs/scratch.
2. Always use DS text styles (`Display {2xl..xs}/{Regular,Medium,Semibold,Bold}`, `Text {xl..s}/{...}`). Never hand-set fontSize + fontFamily.
3. All spacing on the spacing scale (`spacing/tiny..large-3x`). Never type raw px for padding/gap.
4. All radius via `radius/{tiny,small,regular,large}`. No raw radius numbers.
5. Auto Layout everywhere. No absolute positioning except icons-on-shapes and overlays.
6. Light + Dark must both work. Test mode swap before declaring done.
7. Regular + Compact density must both hold up.
8. WCAG AA contrast (≥ 4.5:1 body, ≥ 3:1 large). Verify `color/text/*` against the surface behind.
9. Touch target ≥ 44×44 on mobile breakpoint for any interactive element.
10. Color is never the only signal. Pair status with icon + text.

## Most-used tokens (memorize these)

| Need | Token |
|---|---|
| Page background | `color/special/background/page-bg` |
| Modal background | `color/special/background/modal-bg-primary` |
| Body text | `color/text/01` |
| Secondary text | `color/text/02` |
| Tertiary / disabled | `color/text/03` |
| Link default / hover | `color/link/default` · `color/link/hover` |
| Primary CTA fill | `color/primary/default` (`/hover`, `/active`) |
| Secondary CTA fill | `color/secondary/default` |
| Status success | `color/status/success/fill` |
| Status error | `color/status/error/fill` |
| Status warning | `color/status/warning/fill` |
| Default padding | `spacing/medium` (16px regular · 8px compact) |
| Card-to-card gap | `spacing/large` (24px regular · 16px compact) |
| Button radius | `radius/regular` (8px regular · 4px compact) |
| Modal radius | `radius/large` (16px regular · 8px compact) |

## How to find more

Don't guess. Call tools first:

- **Components** — `list_components({ category?, search? })` returns name, key, variants, defaultVariantKey. 179 components scanned. Use the returned `key` directly with `insert_component`.
- **Templates** — `list_templates({ category? })` returns 18 page templates with slug + dims.
- **Text styles** — `get_styles({ kind: "text", search? })` returns 52 DS text styles (Display 2xl..Text s) with id + font + size.
- **Tokens / variables** — `get_variables({ collectionName? })` lists local variable collections + per-mode values. Hydrogen DS publishes color, spacing, radius, breakpoint collections.

## Workflow

1. Designer asks for a screen → `list_templates` first. If a template fits, `insert_template`.
2. Single component → `list_components` then `insert_component` with variant + `textOverrides`.
3. Bespoke composition → `emit_recipe` with a `Recipe` tree (frame / instance / text).
4. Tweak existing → `modify_node` (text, variant, fill, padding, gap, sizing, rename, visibility, remove).
5. Theme/density flip → `swap_theme` / `swap_density`.
6. Verify visually → `capture_screenshot` after significant builds.

<!-- BEGIN auto-sync: non-negotiable-rules (sync-skills.ts) -->
1. **Never use raw hex values** in components or screens. Always reference a token: `color/primary/default`, `color/text/01`, `color/status/success/fill`, etc.
2. **Always use Text Styles** (`Display {2xl..xs}/{Regular,Medium,Semibold,Bold}`, `Text {xl..s}/{...}`). Never hand-set `fontSize` + `fontFamily`.
3. **All spacing on the Spacing scale via `spacing/*` tokens** (Tiny, Small, Regular, Mid-regular, Medium, Semi, Large, Large 2x, Large 3x). Never type raw px.
4. **All radius via `radius/{tiny,small,regular,large}` tokens.** No raw radius numbers.
5. **Auto Layout everywhere.** No absolute positioning except for icons-on-shapes and overlays.
6. **Light + Dark mode required.** Mode swap must not break any screen. Test both before declaring done.
7. **Regular + Compact density**: layouts must hold up under both spacing/radius modes when applicable.
8. **Color contrast ≥ 4.5:1 body, ≥ 3:1 large** (WCAG AA). Verify `color/text/*` against the surface behind.
9. **Component naming:** PascalCase + slash hierarchy (mirror existing Figma names — e.g., `Button`, `Input`, `Modal`, `Action_list/Item`).
10. **Color is never the only signal.** Pair with icon + text for status.
11. **Touch target ≥ 44×44 on mobile breakpoint** for any interactive element.

---
<!-- END auto-sync: non-negotiable-rules -->

<!-- BEGIN auto-sync: most-used-tokens (sync-skills.ts) -->
| Need | Token |
|---|---|
| Page background | `color/special/background/page-bg` |
| Modal background (primary) | `color/special/background/modal-bg-primary` |
| Modal background (secondary) | `color/special/background/modal-bg-secondary` |
| Dropdown background | `color/special/dropdown/bg` |
| Navigation BG | `color/special/navigation/bg` |
| Body text | `color/text/01` |
| Secondary text | `color/text/02` |
| Tertiary / disabled text | `color/text/03` |
| Link default / hover | `color/link/default` · `color/link/hover` |
| Primary CTA fill | `color/primary/default` (hover: `/hover`, active: `/active`) |
| Secondary CTA fill | `color/secondary/default` |
| Accent fill | `color/accent/default` |
| Clear / surface accent | `color/clear/default` |
| Status success indicator | `color/status/success/fill` (bg: `/bg`, hover: `/bg-hover`) |
| Status error indicator | `color/status/error/fill` (bg: `/bg`, hover: `/bg-hover`) |
| Status warning indicator | `color/status/warning/fill` |
| Status info indicator | `color/status/info/fill` |
| Status neutral | `color/status/neutral/fill` |
| Surface scale | `color/base/01..09` (01 = page-level surface, 09 = strongest contrast) |
| Default padding | `spacing/medium` (16px regular · 8px compact) |
| Card-to-card gap | `spacing/large` (24px regular · 16px compact) |
| Button radius | `radius/regular` (8px regular · 4px compact) |
| Modal radius | `radius/large` (16px regular · 8px compact) |
| Display heading | Text Style `Display {scale}/Semibold` |
| Body | Text Style `Text md/Regular` (16/24) |
| Label / caption | Text Style `Text small/Medium` (14/20) or `Text xs/Regular` |

Full reference: [docs/design-system/01-tokens.md](docs/design-system/01-tokens.md).

---
<!-- END auto-sync: most-used-tokens -->
