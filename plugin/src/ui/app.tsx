/**
 * Root Preact component.
 *
 * Drives the onboarding gate state machine and swaps between gate screens
 * and the chat surface based on resolved state.
 *
 * Wiring covered:
 *   2.5  polls /health every 3s while not ok
 *   2.7  combines bridge + sandbox state via resolveGate
 *   2.13 listens for sandbox:page-changed and re-runs DS-library check
 *   2.15 starts a Poseidon session when state reaches "ok"
 *   2.17 sendBeacon endSession on window unload
 */

import { useEffect, useRef, useState } from "preact/hooks";

import {
  BridgeClient,
  BridgeUnreachableError,
  type HealthReport,
} from "./lib/bridgeClient.ts";
import { resolveGate, type GateScreen } from "./lib/gateState.ts";
import { onSandbox, sendToSandbox } from "./lib/sandboxBridge.ts";
import { SessionClient } from "./lib/sessionClient.ts";
import { OnboardingGate } from "./components/OnboardingGate.tsx";
import { Chat } from "./components/Chat.tsx";
import type { DsLibraryStatus } from "../shared/messages.ts";

const POLL_INTERVAL_MS = 3000;

export function App(): preact.JSX.Element {
  const [bridgeReachable, setBridgeReachable] = useState<boolean>(true);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [dsLibrary, setDsLibrary] = useState<DsLibraryStatus | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const bridgeRef = useRef(new BridgeClient());
  const sessionRef = useRef<SessionClient | null>(null);

  const screen: GateScreen = resolveGate({
    bridgeReachable,
    health,
    dsLibrary,
  });

  // ─── Sandbox handshake ────────────────────────────────────────────────
  useEffect(() => {
    const offLib = onSandbox("sandbox:ds-library-status", (msg) => {
      setDsLibrary(msg.payload);
    });
    const offPage = onSandbox("sandbox:page-changed", () => {
      // Re-check library — designer may have switched files.
      sendToSandbox({ type: "ui:check-ds-library" });
    });
    sendToSandbox({ type: "ui:ready" });
    return () => {
      offLib();
      offPage();
    };
  }, []);

  // ─── Health polling ───────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    async function check(): Promise<void> {
      try {
        const report = await bridgeRef.current.health();
        if (cancelled) return;
        setBridgeReachable(true);
        setHealth(report);
        setErrorMessage(null);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof BridgeUnreachableError) {
          setBridgeReachable(false);
          setHealth(null);
        } else {
          setErrorMessage((err as Error).message);
        }
      }

      if (cancelled) return;
      // Continue polling unless we've reached `ok` and library is enabled —
      // that's the terminal state.
      const current = resolveGate({
        bridgeReachable: true,
        health,
        dsLibrary,
      });
      if (current !== "ok") {
        pollTimer = setTimeout(() => void check(), POLL_INTERVAL_MS);
      }
    }

    void check();
    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
    // We deliberately don't depend on `health` / `dsLibrary` here — the loop
    // self-terminates by checking inside, and resubscribing on each state
    // change would cause double-polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Session lifecycle ────────────────────────────────────────────────
  useEffect(() => {
    if (screen !== "ok") return;
    if (sessionRef.current) return;

    const session = new SessionClient({
      bridge: bridgeRef.current,
      label: dsLibrary?.libraries?.[0]?.libraryName,
      onBridgeUnreachable: () => setBridgeReachable(false),
    });
    sessionRef.current = session;
    void session.start();

    const onUnload = () => session.endBeacon();
    window.addEventListener("pagehide", onUnload);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("pagehide", onUnload);
      window.removeEventListener("beforeunload", onUnload);
      session.endBeacon();
      sessionRef.current = null;
    };
  }, [screen, dsLibrary]);

  // ─── Manual re-check button on gate screens ───────────────────────────
  const onRecheck = (): void => {
    setHealth(null);
    setDsLibrary(null);
    setErrorMessage(null);
    sendToSandbox({ type: "ui:check-ds-library" });
    void bridgeRef.current
      .health()
      .then((r) => {
        setBridgeReachable(true);
        setHealth(r);
      })
      .catch((err) => {
        if (err instanceof BridgeUnreachableError) {
          setBridgeReachable(false);
        } else {
          setErrorMessage((err as Error).message);
        }
      });
  };

  return (
    <div style={{ height: "100%" }}>
      {screen === "ok" ? (
        <Chat sessionId={sessionRef.current?.currentId() ?? null} />
      ) : (
        <OnboardingGate
          screen={screen}
          errorMessage={errorMessage}
          detectedLibraries={dsLibrary?.libraries}
          onRecheck={onRecheck}
        />
      )}
    </div>
  );
}
