---
name: responsive-layouts
description: Desktop / Tablet / Mobile breakpoints + Regular / Compact density. Use when the designer references "mobile", "tablet", "small screen", responsive behavior, or density variants.
when-to-use: Anything responsive, breakpoint, density, layout-by-screen-size.
---

# Responsive layouts

## Breakpoints (Hydrogen surfaces)

| Surface | Width | Source |
|---|---|---|
| Desktop | 1440 | reference design width |
| Tablet | 768 | midpoint |
| Mobile | 360 | base |

Hydrogen also defines `breakpoint/width` token at 1512 — that's the *runtime* desktop minimum. Reference designs use 1440 to leave bleed room.

## Density modes

| Mode | When |
|---|---|
| Regular (default) | Marketing, dashboards, settings, anywhere reading comfort matters |
| Compact | Data-dense lists, admin tools, tables with many rows |

Density is set via the Hydrogen variable collection — flip with `swap_density`. Don't author Regular and Compact as separate frames; one design must hold up under both.

## Mobile rules

- Touch target ≥ 44×44.
- Bottom-aligned primary action when one action dominates (e.g. checkout, form submit).
- Single-column above 768 unless content is genuinely 2-up (e.g. paired metrics).
- Side nav collapses to bottom tab bar or hamburger.

## Tablet

- Treat as wide mobile, not narrow desktop. Often same layout as mobile with wider gutters.
- Two-pane (master/detail) works above ~900 px.

## Desktop

- Side nav stays expanded (256 px) unless designer requests collapsed (64 px).
- Content area max-width 1184 px (matches 1440 frame minus 256 nav).
- KPI cards in 4-up grids ≥ 1280 px wide; collapse to 2-up below.

## Sizing recipes

- Frames inside auto-layout: prefer `sizing.w: "FILL"` for content that should stretch, `"HUG"` for content that defines its own width.
- Avoid fixed widths on text containers — let them FILL the parent and wrap.
