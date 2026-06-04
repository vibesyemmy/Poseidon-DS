/**
 * Tiny event bus between the UI iframe and the Figma plugin sandbox.
 *
 * Figma wraps every sandbox-bound message in `{ pluginMessage: ... }` so
 * the iframe has to read `event.data.pluginMessage` and write
 * `parent.postMessage({ pluginMessage: ... }, "*")`. This module hides that
 * detail and exposes a typed listener API.
 */

import type { SandboxToUi, UiToSandbox } from "../../shared/messages.ts";

// We use `unknown` as the listener payload type internally so we can stuff
// every variant into a single Map without TS complaining about contravariance.
// The exported `onSandbox` function provides the type-safe surface.
type UnknownListener = (msg: SandboxToUi) => void;

const listeners = new Map<SandboxToUi["type"], Set<UnknownListener>>();

window.addEventListener("message", (event) => {
  const wrapped = (event as MessageEvent).data;
  if (!wrapped || typeof wrapped !== "object") return;
  const msg = wrapped.pluginMessage as SandboxToUi | undefined;
  if (!msg || !msg.type) return;
  const set = listeners.get(msg.type);
  if (!set) return;
  for (const l of set) l(msg);
});

export function onSandbox<T extends SandboxToUi["type"]>(
  type: T,
  listener: (msg: Extract<SandboxToUi, { type: T }>) => void,
): () => void {
  const wrapped: UnknownListener = (msg) => {
    if (msg.type === type) listener(msg as Extract<SandboxToUi, { type: T }>);
  };
  const set = listeners.get(type) ?? new Set<UnknownListener>();
  set.add(wrapped);
  listeners.set(type, set);
  return () => {
    set.delete(wrapped);
  };
}

export function sendToSandbox(message: UiToSandbox): void {
  parent.postMessage({ pluginMessage: message }, "*");
}
