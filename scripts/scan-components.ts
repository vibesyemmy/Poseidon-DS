/**
 * scan-components.ts
 *
 * Phase 3.2–3.4.
 *
 * Walks every page of the connected Hydrogen DS Figma file and dumps a
 * compact catalog of published `COMPONENT` and `COMPONENT_SET` nodes —
 * keys, names, variant property schemas, default variants, category from
 * the page name — into `Poseidon/data/components.json`.
 *
 * Why a payload string instead of a Node entry: the Figma Plugin API is
 * only reachable from inside the plugin VM. We don't have a plain HTTP
 * `eval` endpoint on paperclip, so the canonical way to run this is to
 * pass `SCAN_COMPONENTS_PAYLOAD` to `figma_execute` (paperclip MCP) and
 * pipe the JSON result into `data/components.json`.
 *
 * Re-run whenever the DS publishes new components / variants. Idempotent —
 * always re-writes from scratch.
 *
 * Output schema (`data/components.json`):
 *   {
 *     scannedAt: string,            // ISO timestamp
 *     fileKey: string,
 *     fileName: string,
 *     componentCount: number,
 *     components: ComponentMeta[]
 *   }
 *
 *   ComponentMeta = {
 *     key: string,                  // global team-library key
 *     name: string,
 *     category: string,             // derived from owning page name
 *     description?: string,
 *     isVariantSet: boolean,        // true for COMPONENT_SET
 *     variants?: Record<string, string[]>,   // populated for sets
 *     defaultVariant?: Record<string, string>
 *   }
 */

export const SCAN_COMPONENTS_PAYLOAD = String.raw`
  await figma.loadAllPagesAsync();

  const components = [];

  for (const page of figma.root.children) {
    // Skip front-matter / playground pages — they hold examples, not the
    // canonical library entries. The library lives on the per-category
    // pages (Buttons, Input, Modal, etc).
    const skip = ["🖼 Cover", "Infographics", "📝 Release Note", "Playground"];
    if (skip.some((s) => page.name.includes(s))) continue;

    const isPageTemplatePage = page.name === "Page template";
    if (isPageTemplatePage) continue; // templates are scanned separately

    const category = page.name.trim();

    for (const node of page.children) {
      if (node.type === "COMPONENT_SET") {
        const variants = {};
        const props = node.componentPropertyDefinitions || {};
        for (const [k, def] of Object.entries(props)) {
          if (def.type === "VARIANT") {
            variants[k] = def.variantOptions || [];
          }
        }
        components.push({
          key: node.key,
          name: node.name,
          category,
          description: node.description || undefined,
          isVariantSet: true,
          variants,
          defaultVariant: node.defaultVariant || undefined,
        });
      } else if (node.type === "COMPONENT") {
        // Standalone component (no variants).
        components.push({
          key: node.key,
          name: node.name,
          category,
          description: node.description || undefined,
          isVariantSet: false,
        });
      }
    }
  }

  return {
    scannedAt: new Date().toISOString(),
    fileKey: figma.fileKey || null,
    fileName: figma.root.name,
    componentCount: components.length,
    components,
  };
`;
