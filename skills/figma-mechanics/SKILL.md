---
name: figma-mechanics
description: Figma Plugin API auto-layout, constraints, variant props, instance overrides, async fonts, library imports. Use whenever using figma_execute or building emit_recipe / modify_node calls that touch layout, fonts, or component internals.
when-to-use: Any figma_execute / emit_recipe with layout, font work, variant overrides, or library component imports.
---

# Figma mechanics

## Async-first

- Plugin API ops that touch pages, fonts, or library components are async. Always `await`.
- Before reading nodes across pages: `await figma.loadAllPagesAsync()`.
- Before setting `text.characters`: `await figma.loadFontAsync(node.fontName)`. If `fontName` is a `Symbol` (mixed fonts), unify first.

## Library components

- `importComponentByKeyAsync(key)` requires a **component key**, not a component-set key. Sets won't resolve (404).
- For set keys, look up `defaultVariantKey` in `data/components.json`, import that, then `setProperties(...)` to switch variant.
- `setProperties` accepts variant prop names (visible in list_components.variants) directly. For text/swap/boolean props, it accepts the property's full ID — these aren't in the scan; walk the instance's TEXT children by `name` instead (see `applyTextOverrides`).

## Auto Layout

- `layoutMode`: `"NONE"` (manual), `"HORIZONTAL"`, `"VERTICAL"`.
- Children inside auto-layout can set `layoutSizingHorizontal` / `layoutSizingVertical` to `"FILL"` | `"HUG"` | `"FIXED"`.
  - Catch: setting `FILL` only works when the *parent* is auto-layout. Wrap in try/catch.
- Padding: per-edge `paddingTop|Right|Bottom|Left`. Symmetric? Just set all four.
- Gap: `itemSpacing`. Has no effect when `layoutMode === "NONE"`.
- Alignment: `primaryAxisAlignItems` ("MIN"|"CENTER"|"MAX"|"SPACE_BETWEEN"), `counterAxisAlignItems` ("MIN"|"CENTER"|"MAX").

## Variables (tokens)

- Bind a variable to a property with `setBoundVariable("fills", variable)` etc.
- `figma.variables.getLocalVariableCollectionsAsync()` lists collections present *in the current file* (Hydrogen tokens land here once the library is enabled).
- Mode swap: `currentPage.setExplicitVariableModeForCollection(collection, modeId)`. No getter — track current mode yourself if needed.

## Text styles

- Apply with `text.textStyleId = "S:abc...,148:13"` AFTER loading the font.
- Style IDs come from `data/styles.json` (52 DS text styles baked).

## Common bugs

- "Cannot set characters on text with mixed fonts" — `text.fontName` is a `Symbol`. Reset font first: `await figma.loadFontAsync({family:"Inter",style:"Regular"}); text.fontName = {family:"Inter",style:"Regular"};` then set characters.
- "Component set has existing errors" on `componentPropertyDefinitions` — wrap in try/catch and skip; we do this in the scanner.
- `instance.setProperties` throws if a prop name doesn't exist on the set. Always check `list_components(...).variants` for the exact keys first.
