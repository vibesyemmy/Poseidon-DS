/**
 * Plugin-side session lifecycle.
 *
 * Holds a Poseidon session id, heartbeats every 10 s while the plugin is
 * open, and tears down the session via `sendBeacon` on close. Bridge ↔
 * heartbeat contract documented in PLAN §3b.
 *
 * Phase 2.15 — start session on mount
 * Phase 2.16 — heartbeat ticker
 * Phase 2.17 — sendBeacon on close
 * Phase 2.18 — re-issue start if heartbeat returns 404 (bridge restarted)
 */

import { BridgeClient, BridgeUnreachableError } from "./bridgeClient.ts";

export interface SessionClientOptions {
  bridge: BridgeClient;
  /** Heartbeat interval in ms. Defaults to 10s (matches bridge default). */
  intervalMs?: number;
  /** Called when we detect the bridge went away so the UI can switch gate state. */
  onBridgeUnreachable?: () => void;
  /** Optional label to attach to the session (e.g. Figma file key). */
  label?: string;
}

export class SessionClient {
  private id: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly bridge: BridgeClient;
  private readonly intervalMs: number;
  private readonly onBridgeUnreachable?: () => void;
  private readonly label?: string;
  private starting: Promise<string> | null = null;

  constructor(options: SessionClientOptions) {
    this.bridge = options.bridge;
    this.intervalMs = options.intervalMs ?? 10_000;
    this.onBridgeUnreachable = options.onBridgeUnreachable;
    this.label = options.label;
  }

  /**
   * Start (or restart) the session. Idempotent — concurrent calls dedupe via
   * the `starting` promise so heartbeat-after-404 races don't open duplicate
   * sessions.
   */
  async start(): Promise<string> {
    if (this.id) return this.id;
    if (this.starting) return this.starting;

    this.starting = (async () => {
      const info = await this.bridge.startSession(this.label);
      this.id = info.id;
      this.startHeartbeatTicker();
      return info.id;
    })();

    try {
      return await this.starting;
    } catch (err) {
      if (err instanceof BridgeUnreachableError) this.onBridgeUnreachable?.();
      throw err;
    } finally {
      this.starting = null;
    }
  }

  /**
   * Fire-and-forget end via sendBeacon. Call from `figma.on("close")` /
   * `window.beforeunload`. Doesn't await.
   */
  endBeacon(): void {
    if (!this.id) return;
    this.bridge.endSessionBeacon(this.id);
    this.cleanup();
  }

  /** Current session id, if started. */
  currentId(): string | null {
    return this.id;
  }

  // ─── Internals ─────────────────────────────────────────────────────────

  private startHeartbeatTicker(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      void this.beat();
    }, this.intervalMs);
  }

  private async beat(): Promise<void> {
    if (!this.id) return;
    try {
      const info = await this.bridge.heartbeat(this.id);
      if (info === null) {
        // Bridge no longer knows about this session — probably restarted.
        // Drop the id and try to re-start; if the bridge is gone entirely,
        // start() will throw and we'll fall back to onBridgeUnreachable.
        this.id = null;
        try {
          await this.start();
        } catch {
          // Already routed through onBridgeUnreachable in start().
        }
      }
    } catch (err) {
      if (err instanceof BridgeUnreachableError) {
        this.cleanup();
        this.onBridgeUnreachable?.();
      } else {
        // Transient — keep ticking. Next beat will retry.
        console.warn("[poseidon] heartbeat error", err);
      }
    }
  }

  private cleanup(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.id = null;
  }
}
