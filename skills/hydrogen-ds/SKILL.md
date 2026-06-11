---
name: hydrogen-ds
description: Hydrogen Design System reference — non-negotiable rules, template-first enforcement, token shorthand, and how to discover components/styles/variables at runtime. Use on any request that builds, modifies, or inspects UI on a Hydrogen surface.
when-to-use: Always — every UI-building turn.
---

# Hydrogen Design System

Trigger this skill for:
- Creating Figma screens, components, or templates on a Hydrogen surface (file `🖼🖼 Hydrogen Design System 2023 (Desktop)`, key `XySDEos09rLrBZTxVWZHXS`)
- Editing or reviewing existing Hydrogen UI
- Picking colors, spacing, typography, or radius for any visual element
- Composing forms, modals, lists, tables, navigation

## Always do this first

1. `list_templates({})` to see the registry of 5 published page-template variant sets — **always before composing**.
2. `get_variables({})` to confirm Hydrogen color / spacing / radius / breakpoint collections are reachable in the active file.
3. `read_selection({})` if the designer is pointing at something — overrides usually target their selection.
4. Check the non-negotiable rules below; they are NEVER optional.

## Non-negotiable rules

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

## Start from a page template (MANDATORY for new screens)

Hydrogen has **5 published page-template variant sets** on the `Page template` page (List page · Detail page · Form · Onboarding · Settings). **Every new screen MUST be checked against this registry FIRST.** No silent fall-through to atom composition.

### Pre-build template check (mandatory, in order)

1. **Map intent → family** using the Mapping table in `docs/design-system/03-templates.md`.
   - "A page with a table and filter" → **List page**
   - "A detail page" → **Detail page**
   - "A form" → **Form**
   - "A login / OTP / pre-auth" → **Onboarding**
   - "A settings page" → **Settings**
2. **Open the family's row in the Registry** (`03-templates.md` → Registry) and read every variant's `Use when` / `Don't use when` line. Pick the one that fits.
3. **If a variant matches** → walk the gated path (templates_suggest → templates_choose → screen_from_template):
   ```
   // Step A — get ranked candidates (also locks phase='suggested')
   templates_suggest({ intent: "<short paraphrase>", limit: 5 })

   // Step B — lock the choice (also locks phase='chosen', requires 20+ char reason)
   templates_choose({ variantKey: "<one from suggest>", reason: "<why it fits>" })

   // Step C — instantiate. Bridge resets phase to 'idle' on success.
   screen_from_template({ variantKey: "<same as choose>", position?: { x, y } })
   ```
   The bridge detaches the template wrapper after instantiation. The result is a FRAME — atoms inside (Button, Input, Badge, Nav-item, Table item) remain LIBRARY INSTANCES and continue receiving updates.

   **Why detach the template wrapper:** page templates are *scaffolds*, not contracts. Later edits to a template (e.g. a Header redesign) must NOT silently reshape finished screens. Detaching freezes the layout; atoms still live-update for design-system consistency.

4. **If nothing matches** → **HARD STOP via the gate.** Required tool sequence:
   ```
   // Step A — declare no-match with ≥3 considered + ≥40-char rationale.
   //          Phase moves to 'no_match_declared'. Returns { mustAskUser: true }.
   escape_no_template_match({
     intent: "<parsed intent>",
     considered: [ /* ≥3 variant summaries from templates_suggest output */ ],
     rationale: "<why none of these fit>"
   })

   // Step B — ask the designer.
   ask_user({
     question: "No published template matched <intent>. Closest considered: <chip summary>. Options: compose from atoms / refine intent / add a new template."
   })

   // Step C — ONLY if the designer authorizes "compose from atoms":
   screen_compose_from_atoms({
     recipe: <emit_recipe tree>,
     reason: "<short audit reason>",
     userConfirmation: "<the designer's literal answer from ask_user>"
   })
   ```

   **Never call `emit_recipe` or `modify_node` to fabricate a screen on the no-match branch.** The bridge will reject those calls with `TEMPLATE_GATE_VIOLATION`. STEP 2 of ENFORCEMENT.md makes this a deterministic hard stop, not a convention.

### Registry — 5 families (full Use when / Don't use when lines in `03-templates.md`)

- **List page** — `With KPIs and table` · `With tabs and table` · `Empty state`
- **Detail page** — `Simple` · `With tabs` · `Pending` · `Rejected` · `With confirmation modal`
- **Form** — `Simple` · `Multi-section` · `Grouped` · `Bulk upload` · `Wizard`
- **Onboarding** — `Login` · `Login with error toast` · `OTP`
- **Settings** — `Default` · `OTP-protected`

### Prereqs for the registry to be reachable
- The active file has **Hydrogen DS 2023 (Desktop)** added in Assets → Libraries.
- The Hydrogen library is **published**. If a template was edited recently, ask the user to re-publish.
- Poseidon's `list_templates` merges bundled + repo + user templates — always trust its output over guessing slugs.

### Gotchas (verified — these have bitten previous sessions)

- **Templates aren't draggable from Assets like atoms** — they're full-screen Components. Drop one instance per screen, then override.
- **Switching a variant resets nested layer IDs.** Set every variant property (`Item type`, `Alignment`, `Size`, `State`, …) via `modify_node` FIRST, then write text into the new structure. Re-writing text before variant change wastes the override.
- **Some prop combinations return "Unable to find a variant with those property values".** When that happens, split prop changes across smaller `modify_node` calls.
- **Cross-file REST searches often 404** even on published files — Poseidon's `list_templates` already uses the bridge path that works without REST scope.

## Compose from atoms (fallback — ONLY after no-match + express instruction)

1. Create or reuse a Section called "<Surface name>" (e.g. "Monitoring-Dashboard").
2. Inside it, create a Frame at the breakpoint width (1512 desktop / 744 tablet / 390 mobile) via `emit_recipe`.
3. Apply the matching grid style (grid/desktop / grid/tablet / grid/mobile).
4. Set background fill = `color/special/background/page-bg`.
5. Drop in Top bar + Navigation panel - web (or mobile drawer trigger).
6. Build content using existing components first; flag anything missing.

## Most-used tokens (memorize these)

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

## How to find more

Don't guess. Call tools first:

- **Templates** — `list_templates({ category? })` returns the 5 family variant sets with slug + dims. **Always use this before any screen build.**
- **Components** — `list_components({ category?, search? })` returns name, key, variants, defaultVariantKey. Use the returned `key` directly with `insert_component`.
- **Text styles** — `get_styles({ kind: "text", search? })` returns DS text styles (Display 2xl..Text s) with id + font + size.
- **Tokens / variables** — `get_variables({ collectionName? })` lists local variable collections + per-mode values. Hydrogen DS publishes color, spacing, radius, breakpoint collections.

## Workflow

1. **Designer asks for a screen** → `list_templates` FIRST. Map intent → family → variant per Pre-build check. If match → `insert_template`. If no match → HARD STOP via `ask_user`.
2. **Single component** → `list_components` then `insert_component` with variant + `textOverrides`.
3. **Bespoke composition** — only after no-match + express instruction → `emit_recipe` with a `Recipe` tree.
4. **Tweak existing** → `modify_node` (text, variant, fill, padding, gap, sizing, rename, visibility, remove). Set variant changes BEFORE text overrides.
5. **Theme / density flip** → `swap_theme` / `swap_density`.
6. **Verify visually** → `capture_screenshot` after significant builds.

## When unsure

Ask via `ask_user`. Don't pick a fallback hex / font / value / template. Hydrogen's token model is comprehensive — if a value isn't there, propose adding a new token rather than working around the system.
