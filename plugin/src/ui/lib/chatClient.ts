/**
 * /chat SSE consumer.
 *
 * Opens `POST /chat` against the bridge with a prompt, parses Server-Sent
 * Events out of the streaming response, and surfaces them as discrete
 * callbacks the React layer can render.
 *
 * The bridge sends:
 *   meta          one-time, carries streamId
 *   message       every SDK message (assistant, tool_use, result, …)
 *   tool_request  bridge wants the plugin sandbox to execute a tool
 *   done          stream finished cleanly
 *   error         stream failed
 */

import { DEFAULT_BRIDGE_ORIGIN } from "./bridgeClient.ts";

export interface MetaEvent {
  streamId: string;
  model?: string;
  startedAt?: number;
  error?: boolean;
}

export interface ToolRequestEvent {
  requestId: string;
  tool: string;
  input: unknown;
}

export interface DoneEvent {
  durationMs: number;
  costUsd: number;
}

export interface ChatCallbacks {
  onMeta?: (e: MetaEvent) => void;
  /** Raw SDK message; the UI inspects `type` to render assistant text vs tool_use vs result. */
  onMessage?: (msg: Record<string, unknown>) => void;
  onToolRequest?: (e: ToolRequestEvent) => void;
  onDone?: (e: DoneEvent) => void;
  onError?: (message: string) => void;
}

export interface SendChatOptions extends ChatCallbacks {
  prompt: string;
  sessionId?: string;
  resume?: string;
  /** Aborts the stream. */
  signal?: AbortSignal;
  origin?: string;
}

export async function sendChat(opts: SendChatOptions): Promise<void> {
  const origin = opts.origin ?? DEFAULT_BRIDGE_ORIGIN;
  const res = await fetch(`${origin}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      prompt: opts.prompt,
      sessionId: opts.sessionId,
      resume: opts.resume,
    }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    opts.onError?.(`bridge returned ${res.status}`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line (\n\n). Pull complete frames.
      let frameEnd: number;
      while ((frameEnd = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);
        dispatchFrame(frame, opts);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function dispatchFrame(frame: string, cb: ChatCallbacks): void {
  let event = "message";
  let data = "";
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!data) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return;
  }
  switch (event) {
    case "meta":
      cb.onMeta?.(parsed as MetaEvent);
      break;
    case "message":
      cb.onMessage?.(parsed as Record<string, unknown>);
      break;
    case "tool_request":
      cb.onToolRequest?.(parsed as ToolRequestEvent);
      break;
    case "done":
      cb.onDone?.(parsed as DoneEvent);
      break;
    case "error":
      cb.onError?.((parsed as { message?: string }).message ?? "unknown stream error");
      break;
  }
}

// ─── Tool response back to bridge ────────────────────────────────────────

export async function postToolResponse(
  streamId: string,
  requestId: string,
  result: { ok: true; value: unknown } | { ok: false; code: string; message: string },
  origin: string = DEFAULT_BRIDGE_ORIGIN,
): Promise<void> {
  await fetch(`${origin}/tool-response`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ streamId, requestId, result }),
  });
}
