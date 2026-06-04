/**
 * Plugin sandbox — entry point.
 *
 * Runs inside Figma's plugin VM. Only place `figma.*` is available.
 * Communicates with the Preact UI via `figma.ui.postMessage` (out) and the
 * global `figma.ui.onmessage` handler (in).
 *
 * Phase 2 responsibilities:
 *   - Show the UI window
 *   - Respond to `ui:check-ds-library` so the onboarding gate can resolve
 *   - Emit `sandbox:page-changed` so the UI re-runs the library check when
 *     the designer switches pages
 *
 * Phase 4+ will add the full tool surface (insert_template, modify_node,
 * read_selection, etc.).
 */

import type { SandboxToUi, UiToSandbox } from "../shared/messages.ts";
import { runSandboxTool } from "../runtime/tools.ts";

// Show the UI window at sidebar-friendly width.
figma.showUI(__html__, {
  width: 360,
  height: 640,
  title: "Poseidon",
});

function post(msg: SandboxToUi): void {
  figma.ui.postMessage(msg);
}

// ─── Inbound message dispatcher ──────────────────────────────────────────

figma.ui.onmessage = (raw: unknown): void => {
  const msg = raw as UiToSandbox;
  if (!msg || typeof msg !== "object" || !("type" in msg)) return;

  switch (msg.type) {
    case "ui:ready":
      // First handshake — UI iframe just mounted. We push the initial
      // canvas state so the UI can resolve the DS-library gate without a
      // separate round-trip.
      void emitCanvasState();
      void emitDsLibraryStatus();
      break;

    case "ui:check-ds-library":
      void emitDsLibraryStatus();
      break;

    case "ui:get-canvas-state":
      void emitCanvasState();
      break;

    case "ui:close-plugin":
      figma.closePlugin();
      break;

    case "ui:run-tool":
      void handleRunTool(msg.requestId, msg.tool, msg.input);
      break;

    case "ui:turn-start":
      // Close any prior history entry — anything the designer did manually
      // before this turn stays separate from what Poseidon does next.
      figma.commitUndo();
      break;

    case "ui:turn-end":
      // Close the turn's work into a single undo entry. One Cmd+Z reverts
      // the whole turn.
      figma.commitUndo();
      break;

    default: {
      // Exhaustiveness guard — flag in console if a new UI message type
      // ships without a handler here.
      const _exhaustive: never = msg;
      void _exhaustive;
      console.warn("[poseidon-sandbox] unknown message", msg);
    }
  }
};

async function handleRunTool(requestId: string, tool: string, input: unknown): Promise<void> {
  const result = await runSandboxTool(tool, input);
  post({
    type: "sandbox:tool-result",
    requestId,
    tool,
    result: result.ok
      ? { ok: true, value: result.value }
      : { ok: false, code: result.code, message: result.message },
  });
}

// ─── DS library detection ────────────────────────────────────────────────

async function emitDsLibraryStatus(): Promise<void> {
  try {
    const collections = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
    const hasHydrogen = collections.some((c) =>
      c.libraryName?.toLowerCase().includes("hydrogen"),
    );
    post({
      type: "sandbox:ds-library-status",
      payload: {
        hasHydrogen,
        libraries: collections.map((c) => ({
          libraryName: c.libraryName,
          collectionName: c.name,
        })),
      },
    });
  } catch (err) {
    console.error("[poseidon-sandbox] DS library check failed", err);
    post({
      type: "sandbox:ds-library-status",
      payload: { hasHydrogen: false, libraries: [] },
    });
  }
}

// ─── Canvas state ────────────────────────────────────────────────────────

async function emitCanvasState(): Promise<void> {
  try {
    const page = figma.currentPage;
    post({
      type: "sandbox:canvas-state",
      payload: {
        pageId: page.id,
        pageName: page.name,
        // figma.fileKey is only available in full editor mode; fall back gracefully.
        fileKey: (figma as unknown as { fileKey?: string }).fileKey ?? null,
        viewport: {
          x: figma.viewport.bounds.x,
          y: figma.viewport.bounds.y,
          width: figma.viewport.bounds.width,
          height: figma.viewport.bounds.height,
          zoom: figma.viewport.zoom,
        },
      },
    });
  } catch (err) {
    console.error("[poseidon-sandbox] canvas state failed", err);
  }
}

// ─── Re-emit on page change so the UI can re-run gate checks ─────────────

figma.on("currentpagechange", () => {
  post({
    type: "sandbox:page-changed",
    payload: { pageId: figma.currentPage.id, pageName: figma.currentPage.name },
  });
  void emitDsLibraryStatus();
});
