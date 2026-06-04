---
name: ui-ux-principles
description: Visual hierarchy, gestalt, spacing rhythm, content density, scanability. Use when composing or critiquing a screen layout — anything beyond mechanical component placement.
when-to-use: Layout decisions, screen composition, "make it look better", critique requests.
---

# UI / UX principles

## Hierarchy

- One primary action per screen, two max. Everything else is secondary or tertiary.
- Page title at top, action cluster top-right. Don't break this without a reason.
- Heavier weight + larger size = higher importance. Don't use color alone to signal hierarchy.
- Vertical scan order beats horizontal: stack important things, indent supporting.

## Gestalt (grouping by visual cues)

- Proximity > similarity > enclosure for grouping. Tighten related items, loosen unrelated ones.
- Items in the same row of a list/table read as peers. Don't mix kinds.
- Borders/cards are heavy — use whitespace first, lines second, borders last.

## Spacing rhythm

- Use the spacing scale, not arbitrary values.
- Inner padding < gap between siblings < gap between sections.
  - Default card: `spacing/medium` padding, `spacing/regular` gap.
  - Section separator: `spacing/large` or `spacing/large-2x`.
- Equal gap between siblings unless one is intentionally emphasized.

## Density

- Regular density default. Compact for data-dense pages (tables, dashboards).
- Density swap should keep the same visual structure; never change layout to fit content.

## Scanability

- Front-load the meaningful word in labels: "Edit profile" not "Profile edit".
- Truncate with ellipsis after 2 lines max. Never truncate column headers.
- Status indicators left of the item, time stamps right.

## Don't

- Center-align body text. Left-align always (except short hero or empty-state copy).
- Use 5+ font weights on one screen. Pick 2–3.
- Mix radius scales. Cards use one radius; buttons inside use a related but smaller one (e.g. card `radius/large`, button `radius/regular`).
- Pad asymmetrically without reason.
