/**
 * Session lifecycle manager.
 *
 * The bridge is tied to plugin lifecycle: when the plugin closes, the bridge
 * exits. To support that without losing state on a transient network blip,
 * we ref-count active plugin sessions:
 *
 *   POST /session/start       → mint a session id, add to active set
 *   POST /session/heartbeat   → refresh lastBeatAt for that session
 *   POST /session/end         → drop the session
 *
 * A reaper interval evicts sessions whose `lastBeatAt` is older than
 * `idleTimeoutMs`. When the active set goes empty and the bridge has been
 * running longer than `minLingerMs`, the bridge initiates graceful shutdown.
 *
 * Phase 1.13 — endpoint handlers (server.ts wires these)
 * Phase 1.14 — reaper interval + shutdown callback
 * Phase 1.15 — env-var tunables
 */

import { randomUUID } from "node:crypto";

export interface SessionManagerConfig {
  /** How often the plugin claims it will heartbeat (informational, returned to client). */
  heartbeatIntervalMs: number;
  /** Drop a session if its last heartbeat is older than this. */
  idleTimeoutMs: number;
  /** Minimum bridge lifetime before idle shutdown can fire (covers cold-start race). */
  minLingerMs: number;
  /** How often the reaper checks for stale sessions. */
  reaperIntervalMs: number;
  /** Called when the manager decides the bridge should exit. */
  onIdleShutdown: (reason: string) => void;
}

interface SessionRecord {
  id: string;
  startedAt: number;
  lastBeatAt: number;
  /** Optional plugin-supplied label, e.g. Figma file key. */
  label?: string;
}

export interface SessionInfo {
  id: string;
  startedAt: number;
  lastBeatAt: number;
  ageMs: number;
  staleMs: number;
  label?: string;
}

/**
 * Parse env-var tunables (Phase 1.15). Falls back to the defaults documented
 * in PLAN §3b.
 */
export function configFromEnv(
  onIdleShutdown: SessionManagerConfig["onIdleShutdown"],
  env: NodeJS.ProcessEnv = process.env,
): SessionManagerConfig {
  const num = (name: string, fallback: number): number => {
    const raw = env[name];
    if (!raw) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    heartbeatIntervalMs: num("POSEIDON_HEARTBEAT_INTERVAL_MS", 10_000),
    idleTimeoutMs: num("POSEIDON_IDLE_TIMEOUT_MS", 30_000),
    minLingerMs: num("POSEIDON_MIN_LINGER_MS", 5_000),
    reaperIntervalMs: num("POSEIDON_REAPER_INTERVAL_MS", 5_000),
    onIdleShutdown,
  };
}

export class SessionManager {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly bootTime: number;
  private reaperTimer: NodeJS.Timeout | null = null;
  private shuttingDown = false;

  constructor(private readonly config: SessionManagerConfig) {
    this.bootTime = Date.now();
  }

  /** Start the reaper interval. Call once at bridge boot. */
  start(): void {
    if (this.reaperTimer) return;
    this.reaperTimer = setInterval(() => this.reap(), this.config.reaperIntervalMs);
    // Don't keep the event loop alive on the reaper alone — the HTTP server
    // is the canonical liveness anchor.
    this.reaperTimer.unref?.();
  }

  /** Stop the reaper. Call from shutdown handler. */
  stop(): void {
    if (this.reaperTimer) {
      clearInterval(this.reaperTimer);
      this.reaperTimer = null;
    }
  }

  // ─── HTTP handlers ─────────────────────────────────────────────────────

  /** POST /session/start */
  startSession(label?: string): SessionInfo {
    const id = randomUUID();
    const now = Date.now();
    this.sessions.set(id, { id, startedAt: now, lastBeatAt: now, label });
    return this.summarize(this.sessions.get(id)!);
  }

  /** POST /session/heartbeat */
  heartbeat(id: string): { ok: true; info: SessionInfo } | { ok: false; reason: "unknown-session" } {
    const s = this.sessions.get(id);
    if (!s) return { ok: false, reason: "unknown-session" };
    s.lastBeatAt = Date.now();
    return { ok: true, info: this.summarize(s) };
  }

  /** POST /session/end */
  endSession(id: string): { ok: true } | { ok: false; reason: "unknown-session" } {
    const existed = this.sessions.delete(id);
    return existed ? { ok: true } : { ok: false, reason: "unknown-session" };
  }

  // ─── Introspection ─────────────────────────────────────────────────────

  activeCount(): number {
    return this.sessions.size;
  }

  list(): SessionInfo[] {
    return [...this.sessions.values()].map((s) => this.summarize(s));
  }

  uptimeMs(): number {
    return Date.now() - this.bootTime;
  }

  // ─── Reaper ────────────────────────────────────────────────────────────

  private reap(): void {
    if (this.shuttingDown) return;
    const now = Date.now();

    for (const [id, s] of this.sessions) {
      if (now - s.lastBeatAt > this.config.idleTimeoutMs) {
        this.sessions.delete(id);
      }
    }

    if (
      this.sessions.size === 0 &&
      now - this.bootTime > this.config.minLingerMs
    ) {
      this.shuttingDown = true;
      this.config.onIdleShutdown("no active sessions and idle timeout reached");
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private summarize(s: SessionRecord): SessionInfo {
    const now = Date.now();
    return {
      id: s.id,
      startedAt: s.startedAt,
      lastBeatAt: s.lastBeatAt,
      ageMs: now - s.startedAt,
      staleMs: now - s.lastBeatAt,
      label: s.label,
    };
  }
}
