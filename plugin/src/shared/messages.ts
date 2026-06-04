/**
 * UI ↔ sandbox message protocol.
 *
 * The Preact UI iframe and the Figma plugin sandbox can't share imports —
 * they're separate contexts — so they communicate via `postMessage`. Both
 * sides import this file at build time so the type contract stays in sync.
 *
 * Naming convention:
 *   ui:*       sent UI → sandbox
 *   sandbox:*  sent sandbox → UI
 */

// ─── UI → sandbox ────────────────────────────────────────────────────────

export type UiToSandbox =
  | {
      type: "ui:ready";
    }
  | {
      type: "ui:check-ds-library";
    }
  | {
      type: "ui:get-canvas-state";
    }
  | {
      type: "ui:close-plugin";
    }
  | {
      type: "ui:run-tool";
      requestId: string;
      tool: string;
      input: unknown;
    }
  | {
      type: "ui:turn-start";
    }
  | {
      type: "ui:turn-end";
    };

// ─── sandbox → UI ────────────────────────────────────────────────────────

export interface DsLibraryStatus {
  hasHydrogen: boolean;
  libraries: Array<{ libraryName: string; collectionName?: string }>;
}

export interface CanvasState {
  pageId: string;
  pageName: string;
  fileKey: string | null; // Figma exposes this via `figma.fileKey` on full editor only
  viewport: { x: number; y: number; width: number; height: number; zoom: number };
}

export type SandboxToUi =
  | {
      type: "sandbox:ds-library-status";
      payload: DsLibraryStatus;
    }
  | {
      type: "sandbox:canvas-state";
      payload: CanvasState;
    }
  | {
      type: "sandbox:page-changed";
      payload: { pageId: string; pageName: string };
    }
  | {
      type: "sandbox:tool-result";
      requestId: string;
      tool: string;
      /** Discriminated by `ok` matching ToolResult<unknown> from runtime/tools.ts. */
      result: { ok: true; value: unknown } | { ok: false; code: string; message: string };
    };
