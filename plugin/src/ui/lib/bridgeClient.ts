/**
 * Bridge HTTP client.
 *
 * Wraps fetch calls to `http://127.0.0.1:9334` with the shape the plugin UI
 * expects. Failures are normalized to a `BridgeError` so the onboarding gate
 * can distinguish "bridge offline" (network error) from "bridge replied but
 * with bad state".
 *
 * Phase 2.4 — this file.
 * SSE chat streaming lands in Phase 4.
 */

export const DEFAULT_BRIDGE_ORIGIN = "http://localhost:9334";

export class BridgeUnreachableError extends Error {
  constructor(public readonly cause: unknown) {
    super("bridge-unreachable");
    this.name = "BridgeUnreachableError";
  }
}

export interface BridgePing {
  ok: true;
  name: string;
  version: string;
  uptimeMs: number;
  activeSessions: number;
}

export interface HealthReport {
  state:
    | "ok"
    | "claude-code-missing"
    | "claude-code-unauthed"
    | "claude-code-no-credit"
    | "anthropic-unreachable"
    | "sdk-init-failed";
  message: string;
  checks: {
    claudeDir: { ok: boolean; code: string; message: string };
    claudeBinary: { ok: boolean; code: string; message: string };
    anthropicPing: { ok: boolean; code: string; message: string };
  };
  timestamp: number;
}

export interface SessionInfo {
  id: string;
  startedAt: number;
  lastBeatAt: number;
  ageMs: number;
  staleMs: number;
  label?: string;
}

export interface BridgeClientOptions {
  origin?: string;
  /** AbortSignal wired into every fetch (e.g. plugin shutdown). */
  signal?: AbortSignal;
}

export class BridgeClient {
  private readonly origin: string;
  private readonly signal?: AbortSignal;

  constructor(options: BridgeClientOptions = {}) {
    this.origin = options.origin ?? DEFAULT_BRIDGE_ORIGIN;
    this.signal = options.signal;
  }

  async ping(): Promise<BridgePing> {
    return this.getJson<BridgePing>("/ping");
  }

  async health(opts: { skipPing?: boolean } = {}): Promise<HealthReport> {
    const path = opts.skipPing ? "/health?skipPing=1" : "/health";
    return this.getJson<HealthReport>(path);
  }

  async listTemplates(): Promise<{
    templates: Array<{ slug: string; name: string; category: string; width: number; height: number }>;
  }> {
    return this.getJson("/templates");
  }

  async listSkills(): Promise<{
    count: number;
    warnings: string[];
    skills: Array<{ name: string; description: string; whenToUse: string | null; origin: string; bodyChars: number }>;
  }> {
    return this.getJson("/skills");
  }

  async listComponents(): Promise<{
    components: Array<{
      key: string;
      name: string;
      category: string;
      isVariantSet: boolean;
      variants?: Record<string, string[]>;
      defaultVariantKey?: string;
      defaultVariantName?: string;
    }>;
  }> {
    return this.getJson("/components");
  }

  async startSession(label?: string): Promise<SessionInfo> {
    const body = label ? { label } : {};
    const res = await this.postJson<{ ok: true; session: SessionInfo }>("/session/start", body);
    return res.session;
  }

  async heartbeat(id: string): Promise<SessionInfo | null> {
    try {
      const res = await this.postJson<{ ok: true; session: SessionInfo }>(
        "/session/heartbeat",
        { id },
      );
      return res.session;
    } catch (err) {
      // 404 means the session expired or bridge restarted; caller should
      // re-issue startSession() and recover.
      if (err instanceof BridgeHttpError && err.status === 404) return null;
      throw err;
    }
  }

  /**
   * End the session synchronously via `navigator.sendBeacon`. Survives the
   * iframe being torn down by Figma on close. Returns true if the beacon was
   * queued — false means the browser refused (rare).
   */
  endSessionBeacon(id: string): boolean {
    try {
      const url = `${this.origin}/session/end`;
      const blob = new Blob([JSON.stringify({ id })], { type: "application/json" });
      return navigator.sendBeacon(url, blob);
    } catch {
      return false;
    }
  }

  // ─── Internals ─────────────────────────────────────────────────────────

  private async getJson<T>(path: string): Promise<T> {
    return this.fetchJson<T>(path, { method: "GET" });
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    return this.fetchJson<T>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  private async fetchJson<T>(path: string, init: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.origin}${path}`, { ...init, signal: this.signal });
    } catch (err) {
      throw new BridgeUnreachableError(err);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new BridgeHttpError(res.status, text || res.statusText);
    }
    return (await res.json()) as T;
  }
}

export class BridgeHttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "BridgeHttpError";
  }
}
