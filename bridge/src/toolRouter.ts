/**
 * Tool round-trip router.
 *
 * Bridge-side SDK MCP tools execute in this Node process, but most of them
 * need `figma.*` which only lives in the plugin sandbox. The router wires
 * those calls up over the active SSE chat stream:
 *
 *   bridge tool handler
 *     ↓ generates requestId
 *     ↓ writes SSE  { event: "tool_request", data: { requestId, tool, input } }
 *     ↓ awaits promise
 *
 *   plugin UI iframe
 *     ↑ receives SSE event
 *     ↑ forwards to sandbox via postMessage
 *
 *   plugin sandbox
 *     ↑ executes tool, posts result back to UI
 *
 *   plugin UI iframe
 *     ↑ POSTs /tool-response { streamId, requestId, result }
 *
 *   bridge /tool-response handler
 *     ↑ looks up router by streamId
 *     ↑ resolves the awaited promise
 *
 *   bridge tool handler
 *     ↓ returns result to SDK → SDK passes back to Claude
 */

import { randomUUID } from "node:crypto";
import type { SSEStreamingApi } from "hono/streaming";

export type SandboxToolResult =
  | { ok: true; value: unknown }
  | { ok: false; code: string; message: string };

interface PendingCall {
  resolve: (result: SandboxToolResult) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class ToolRouter {
  readonly id: string = randomUUID();
  private readonly pending = new Map<string, PendingCall>();
  private closed = false;

  constructor(
    private readonly stream: SSEStreamingApi,
    private readonly timeoutMs: number = 60_000,
  ) {}

  /**
   * Send a tool_request over SSE and resolve when the plugin POSTs the
   * matching tool_response. Times out after `timeoutMs`.
   */
  async dispatch(tool: string, input: unknown): Promise<SandboxToolResult> {
    if (this.closed) {
      return { ok: false, code: "STREAM_CLOSED", message: "tool router closed" };
    }
    const requestId = randomUUID();
    const payload = { requestId, tool, input };

    const promise = new Promise<SandboxToolResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({
          ok: false,
          code: "TIMEOUT",
          message: `sandbox tool '${tool}' did not respond in ${this.timeoutMs}ms`,
        });
      }, this.timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
    });

    try {
      await this.stream.writeSSE({
        event: "tool_request",
        data: JSON.stringify(payload),
      });
    } catch (err) {
      const p = this.pending.get(requestId);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(requestId);
      }
      return { ok: false, code: "SSE_WRITE_FAILED", message: String(err) };
    }

    return promise;
  }

  /** Called by /tool-response route. */
  resolve(requestId: string, result: SandboxToolResult): boolean {
    const entry = this.pending.get(requestId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pending.delete(requestId);
    entry.resolve(result);
    return true;
  }

  close(): void {
    this.closed = true;
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve({ ok: false, code: "STREAM_CLOSED", message: "chat stream ended" });
      this.pending.delete(id);
    }
  }
}

// ─── Module-level registry ───────────────────────────────────────────────

const routers = new Map<string, ToolRouter>();

export function registerRouter(router: ToolRouter): void {
  routers.set(router.id, router);
}

export function unregisterRouter(routerId: string): void {
  const r = routers.get(routerId);
  if (r) r.close();
  routers.delete(routerId);
}

export function getRouter(routerId: string): ToolRouter | undefined {
  return routers.get(routerId);
}
