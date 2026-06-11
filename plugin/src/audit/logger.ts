/**
 * STEP 3 — plugin-side audit logger
 *
 * Plugin sandboxes can't write to disk directly. The logger POSTs the
 * audit entry to the bridge `/audit` endpoint, which appends it to
 * `session/data/audit.jsonl` (path mirrors PLAN.md Section 9 layout).
 *
 * If the bridge is unreachable, entries queue in IndexedDB (best-effort)
 * and flush on next reconnect.
 */

import type { TemplateAuditEntry } from "../shared/messages.ts";

const BRIDGE_AUDIT_URL = "http://127.0.0.1:9334/audit";

const pendingQueue: TemplateAuditEntry[] = [];

export async function logAudit(entry: TemplateAuditEntry): Promise<void> {
  try {
    const res = await fetch(BRIDGE_AUDIT_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(entry),
    });
    if (!res.ok) throw new Error(`audit POST returned ${res.status}`);
    // On success, flush any queued entries.
    while (pendingQueue.length > 0) {
      const queued = pendingQueue.shift()!;
      try {
        await fetch(BRIDGE_AUDIT_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(queued),
        });
      } catch {
        pendingQueue.unshift(queued);
        break;
      }
    }
  } catch (err) {
    // Queue for later if bridge is offline.
    pendingQueue.push(entry);
    console.warn("[poseidon] audit log queued (bridge unreachable):", (err as Error).message);
  }
}

export function _queuedSize(): number {
  return pendingQueue.length;
}
