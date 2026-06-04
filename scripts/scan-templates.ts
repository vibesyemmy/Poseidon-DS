/**
 * scan-templates.ts
 *
 * Phase 3.5–3.6.
 *
 * Walks the `Page template` page of the Hydrogen DS file and emits a
 * lightweight catalog of each top-level template frame: name, node id,
 * dimensions, child count, inferred category, screenshot URL (optional).
 *
 * For Phase 3 we emit *metadata only*. The full recipe extraction (which
 * walks the tree into the schema in `runtime/schema.ts`) lives in
 * `runtime/capture.ts` and is exercised by Phase 7's "Save as template"
 * authoring flow. Phase 4's `insert_template` tool will use the same code
 * path the other direction.
 *
 * Output: `Poseidon/data/seed-templates.json`
 *
 *   {
 *     scannedAt: string,
 *     fileKey: string,
 *     pageId: string,
 *     templateCount: number,
 *     templates: TemplateMeta[]
 *   }
 *
 *   TemplateMeta = {
 *     slug: string,        // kebab-case from name
 *     name: string,        // exact frame name
 *     nodeId: string,
 *     width: number,
 *     height: number,
 *     category: TemplateMeta["category"],   // inferred from name keywords
 *     description: string  // best-effort from frame description or empty
 *   }
 *
 * Re-run after adding new templates to the `Page template` page.
 *
 * The payload below is what gets sent to `figma_execute` via paperclip MCP.
 */

export const SCAN_TEMPLATES_PAYLOAD = String.raw`
  await figma.loadAllPagesAsync();
  const page = figma.root.children.find((p) => p.name === "Page template");
  if (!page) return { error: "Page template page not found" };

  const templates = [];

  function inferCategory(name) {
    const n = name.toLowerCase();
    if (n.includes("dashboard")) return "Dashboard";
    if (n.includes("list")) return "List";
    if (n.includes("detail")) return "Detail";
    if (n.includes("form")) return "Form";
    if (n.includes("wizard")) return "Form";
    if (n.includes("onboarding") || n.includes("login") || n.includes("register")) return "Onboarding";
    if (n.includes("error") || n.includes("404") || n.includes("500")) return "Error";
    return "Other";
  }

  function slugify(s) {
    return s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  for (const node of page.children) {
    // Only top-level FRAME nodes count as templates. Sections and stickies
    // are organizational, not authored.
    if (node.type !== "FRAME") continue;
    templates.push({
      slug: slugify(node.name),
      name: node.name,
      nodeId: node.id,
      width: Math.round(node.width),
      height: Math.round(node.height),
      category: inferCategory(node.name),
      description: node.description || "",
    });
  }

  return {
    scannedAt: new Date().toISOString(),
    fileKey: figma.fileKey || null,
    pageId: page.id,
    templateCount: templates.length,
    templates,
  };
`;
