---
name: composition-patterns
description: Concrete recipe skeletons for the most common Hydrogen page compositions — standard page, card, empty state, two-column form, list page, modal. Use when building any bespoke UI via emit_recipe instead of insert_template.
when-to-use: Any emit_recipe call, or whenever a designer asks to "build", "compose", or "lay out" something that doesn't have a 1:1 template.
---

# Composition patterns

These are copy-and-adapt recipes. Replace placeholder content (component keys, text, instance names) with what the request actually needs. Token names in `var(...)` resolve at instantiation — use them, don't hand-write hex.

**ONE recipe per request.** Pick the single skeleton below that best matches what was asked, adapt it, call `emit_recipe` ONCE with the complete tree. Do NOT call `emit_recipe` per example or per section. The root is one frame; sections are nested children.

## Standard page (sidenav + header + content)

1440×1024 frame. Sidebar 256, content area FILLs the rest. Outer page bg uses the page-bg token so dark mode just works.

```json
{
  "kind": "frame",
  "name": "Page",
  "layout": "HORIZONTAL",
  "padding": 0,
  "gap": 0,
  "sizing": { "w": 1440, "h": 1024 },
  "fill": "var(color/special/background/page-bg)",
  "children": [
    { "kind": "instance", "key": "<navigation-panel-default-variant-key>", "name": "Navigation panel" },
    {
      "kind": "frame",
      "name": "Content area",
      "layout": "VERTICAL",
      "padding": 24,
      "gap": 24,
      "sizing": { "w": "FILL", "h": "FILL" },
      "children": [
        { "kind": "text", "chars": "Page title", "styleId": "S:d9020f2581a9fd58aa103404f4cf6730ffa67b66,", "colorToken": "var(color/text/01)" }
      ]
    }
  ]
}
```

Look up the navigation panel key with `list_components({ category: "Navigation" })`. Look up text style ids with `get_styles({ kind: "text" })`.

## Card with title + body + CTA

Vertical stack, HUG height, FILL width inside its parent. Card padding 16, section gap 16.

```json
{
  "kind": "frame",
  "name": "Card",
  "layout": "VERTICAL",
  "padding": 16,
  "gap": 12,
  "sizing": { "w": "FILL", "h": "HUG" },
  "fill": "var(color/base/01)",
  "cornerRadius": 8,
  "children": [
    { "kind": "text", "chars": "Card title", "styleId": "S:616b6bd024901bde1e156497e9f1e7f8424d2dbd,", "colorToken": "var(color/text/01)" },
    { "kind": "text", "chars": "Body copy explaining the card.", "styleId": "S:7297216a79343561831a449720dd6fdf05049a7a,", "colorToken": "var(color/text/02)" },
    { "kind": "instance", "key": "<button-variant-key>", "variant": { "Type": "Primary", "Size": "Small" }, "textOverrides": { "Label": "Primary action" } }
  ]
}
```

For the Button key, call `list_components({ search: "Button" })`. Pick the variant that matches the requested type — the variant prop map gets applied after instantiation.

## Empty state

Centered vertical stack. Hydrogen has an `EmptyState` component (`f8d1ffa5...`) — prefer that to building from scratch. Use this skeleton only when the designer wants a custom empty state shape.

```json
{
  "kind": "frame",
  "name": "Empty state",
  "layout": "VERTICAL",
  "padding": 24,
  "gap": 16,
  "sizing": { "w": "FILL", "h": "FILL" },
  "align": { "primary": "CENTER", "counter": "CENTER" },
  "fill": "var(color/special/background/page-bg)",
  "children": [
    { "kind": "text", "chars": "No data yet", "styleId": "S:d9020f2581a9fd58aa103404f4cf6730ffa67b66,", "colorToken": "var(color/text/01)", "align": "CENTER" },
    { "kind": "text", "chars": "Once you create something, it will show up here.", "styleId": "S:9df5e446e04be7e037d61da4ea5864cbd2e8634a,", "colorToken": "var(color/text/02)", "align": "CENTER" },
    { "kind": "instance", "key": "<button-variant-key>", "variant": { "Type": "Primary", "Size": "Medium" }, "textOverrides": { "Label": "Create first item" } }
  ]
}
```

## Two-column form

Vertical sections, each containing label + input. Use the Input variant set (`59f5253d...`). Right-side column FILLs.

```json
{
  "kind": "frame",
  "name": "Form",
  "layout": "VERTICAL",
  "padding": 24,
  "gap": 24,
  "sizing": { "w": "FILL", "h": "HUG" },
  "fill": "var(color/base/01)",
  "cornerRadius": 8,
  "children": [
    {
      "kind": "frame",
      "name": "Row",
      "layout": "HORIZONTAL",
      "gap": 16,
      "sizing": { "w": "FILL", "h": "HUG" },
      "children": [
        {
          "kind": "frame", "name": "Field", "layout": "VERTICAL", "gap": 6,
          "sizing": { "w": "FILL", "h": "HUG" },
          "children": [
            { "kind": "text", "chars": "First name", "styleId": "S:9af1deb17349c0837f2d889833bd08c97a9e36ca,", "colorToken": "var(color/text/01)" },
            { "kind": "instance", "key": "<input-variant-key>", "variant": { "Content type": "Text", "State": "Default" } }
          ]
        },
        {
          "kind": "frame", "name": "Field", "layout": "VERTICAL", "gap": 6,
          "sizing": { "w": "FILL", "h": "HUG" },
          "children": [
            { "kind": "text", "chars": "Last name", "styleId": "S:9af1deb17349c0837f2d889833bd08c97a9e36ca,", "colorToken": "var(color/text/01)" },
            { "kind": "instance", "key": "<input-variant-key>", "variant": { "Content type": "Text", "State": "Default" } }
          ]
        }
      ]
    }
  ]
}
```

## List page (header + search + table)

```json
{
  "kind": "frame",
  "name": "Content area",
  "layout": "VERTICAL",
  "padding": 24,
  "gap": 24,
  "sizing": { "w": "FILL", "h": "FILL" },
  "fill": "var(color/special/background/page-bg)",
  "children": [
    {
      "kind": "frame",
      "name": "Header row",
      "layout": "HORIZONTAL",
      "gap": 16,
      "sizing": { "w": "FILL", "h": "HUG" },
      "align": { "primary": "SPACE_BETWEEN", "counter": "CENTER" },
      "children": [
        { "kind": "text", "chars": "Items", "styleId": "S:d9020f2581a9fd58aa103404f4cf6730ffa67b66,", "colorToken": "var(color/text/01)" },
        { "kind": "instance", "key": "<button-variant-key>", "variant": { "Type": "Primary", "Size": "Medium" }, "textOverrides": { "Label": "+ New item" } }
      ]
    },
    { "kind": "instance", "key": "<search-and-filter-key>", "name": "Search & filter" },
    { "kind": "instance", "key": "<table-key>", "name": "Table" }
  ]
}
```

## Token shorthand (paste-ready)

| Use | Value to paste |
|---|---|
| Page background | `var(color/special/background/page-bg)` |
| Card / surface fill | `var(color/base/01)` |
| Body text | `var(color/text/01)` |
| Secondary text | `var(color/text/02)` |
| Tertiary / disabled text | `var(color/text/03)` |
| Primary CTA fill | `var(color/primary/default)` |
| Status success | `var(color/status/success/fill)` |
| Status error | `var(color/status/error/fill)` |

## Sizing checklist

- Outer page frame: `1440 × 1024` (or 982 for list/dashboard, 900 for onboarding).
- Sidebar: `256` fixed width.
- Content area: `FILL × FILL` inside the page frame.
- Cards in a column: `FILL × HUG`.
- Headers / footers: `FILL × HUG`.
- Inputs in a form row: `FILL × HUG` each, equal columns share the row width via FILL.

## After building

Always `capture_screenshot` the inserted root and inspect it. Look for: missing fills (white-on-white frames), components rendered as `120 × 40` pink stubs (failed import), overlapping children. Fix via `modify_node` before reporting back.
