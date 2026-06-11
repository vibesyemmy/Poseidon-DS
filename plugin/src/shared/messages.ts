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
    }
  // STEP 3 — template-first UI ⇄ sandbox protocol (ENFORCEMENT.md)
  | {
      type: "ui:proposal-response";
      proposalId: string;
      decision: "accept" | "reject" | "pick_different" | "no_match";
      reason?: string;
    }
  | {
      type: "ui:mutation-ack";
      mutationId: string;
      approved: boolean;
    }
  | {
      type: "ui:template-check-skipped";
      streamId: string;
      toolName: string;
      hint?: string;
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
    }
  // STEP 3 — sandbox-side mutation watcher events
  | {
      type: "sandbox:mutation-intent";
      mutationId: string;
      tool: string;
      proposalId?: string;
    }
  | {
      type: "sandbox:mutation-rejected-no-approval";
      mutationId: string;
      tool: string;
      reason: string;
    }
  | {
      type: "sandbox:override-logged";
      auditEntry: TemplateAuditEntry;
    };

// ─── STEP 3 shared types ────────────────────────────────────────────────

export interface TemplateProposal {
  proposalId: string;
  intent: string;
  variantKey: string;
  variantName: string;
  family: "List" | "Detail" | "Form" | "Onboarding" | "Settings";
  useWhen: string;
  dontUseWhen: string;
  score: number;
  thumbnailUrl?: string;
}

export interface NoMatchProposal {
  proposalId: string;
  intent: string;
  considered: TemplateProposal[];
  rationale: string;
}

export interface TemplateAuditEntry {
  timestamp: string;
  designerEmail?: string;
  sessionId: string;
  intentText: string;
  proposedTemplateId?: string;
  proposedVariant?: string;
  decision: "accept" | "reject" | "pick_different" | "no_match" | "compose_override";
  overrideReason?: string;
  mutationProposalId?: string;
}
