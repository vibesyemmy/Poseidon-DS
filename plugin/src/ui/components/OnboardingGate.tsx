/**
 * OnboardingGate — renders the appropriate first-launch screen based on
 * resolved gate state. All 6 failure states + loading + ok.
 */

import { useEffect, useState } from "preact/hooks";

import type { GateScreen } from "../lib/gateState.ts";

interface Props {
  screen: GateScreen;
  errorMessage?: string | null;
  /** Libraries discovered by the sandbox check, shown for diagnostic context. */
  detectedLibraries?: Array<{ libraryName: string; collectionName?: string }>;
  /** Called when the user clicks "Re-check" on any screen. */
  onRecheck: () => void;
}

interface ScreenContent {
  title: string;
  body: string;
  cta?: { label: string; command?: string; href?: string };
}

const SCREENS: Record<Exclude<GateScreen, "ok" | "loading">, ScreenContent> = {
  "bridge-unreachable": {
    title: "Start the Poseidon bridge",
    body: "The bridge is the local Node process that connects Poseidon to your Claude Code account. Run this in a terminal, then click Re-check.",
    cta: { label: "Copy command", command: "cd Poseidon/bridge && pnpm dev" },
  },
  "claude-code-missing": {
    title: "Install Claude Code",
    body: "Poseidon uses your Claude Code subscription to talk to Claude. Install Claude Code from claude.com/code, then log in.",
    cta: { label: "Open installer", href: "https://claude.com/code" },
  },
  "claude-code-unauthed": {
    title: "Log into Claude Code",
    body: "Claude Code is installed but not signed in. Run this in a terminal to log in:",
    cta: { label: "Copy command", command: "claude login" },
  },
  "claude-code-no-credit": {
    title: "No credit available",
    body: "Your Claude Code subscription has no credit remaining for API usage. Top up or check your plan in the Anthropic console.",
    cta: { label: "Open console", href: "https://console.anthropic.com" },
  },
  "anthropic-unreachable": {
    title: "Anthropic is unreachable",
    body: "The bridge could not reach the Anthropic API. This is usually a network or transient server issue. Wait a moment and re-check.",
  },
  "sdk-init-failed": {
    title: "Agent SDK failed to start",
    body: "The Claude Agent SDK couldn't initialize. This is likely a Poseidon bug or a Claude Code upgrade issue. Check the bridge log and re-check.",
  },
  "ds-library-disabled": {
    title: "Enable the Hydrogen library",
    body:
      "Poseidon builds screens from your Hydrogen Design System components, which means the Hydrogen library has to be enabled for this file.\n\n" +
      "Open the Assets panel → click 'Libraries' (book icon) → search 'Hydrogen' → toggle it on. Then re-check.",
  },
};

export function OnboardingGate({
  screen,
  errorMessage,
  detectedLibraries,
  onRecheck,
}: Props): preact.JSX.Element | null {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  if (screen === "ok") return null;

  if (screen === "loading") {
    return (
      <div style={containerStyle}>
        <div style={spinnerDotStyle} />
        <p style={mutedTextStyle}>Checking your setup…</p>
      </div>
    );
  }

  const content = SCREENS[screen];

  return (
    <div style={containerStyle}>
      <h2 style={titleStyle}>{content.title}</h2>
      <p style={bodyStyle}>{content.body}</p>

      {content.cta?.command && (
        <div style={commandRowStyle}>
          <code style={codeStyle}>{content.cta.command}</code>
          <button
            type="button"
            style={buttonStyle}
            onClick={() => {
              void navigator.clipboard?.writeText(content.cta!.command!);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : content.cta.label}
          </button>
        </div>
      )}

      {content.cta?.href && (
        <a href={content.cta.href} target="_blank" rel="noreferrer" style={linkStyle}>
          {content.cta.label} ↗
        </a>
      )}

      {errorMessage && <p style={errorTextStyle}>{errorMessage}</p>}

      {screen === "ds-library-disabled" && detectedLibraries && (
        <div style={diagBoxStyle}>
          <p style={diagTitleStyle}>
            {detectedLibraries.length === 0
              ? "No libraries detected in this file."
              : "Libraries currently available to this file:"}
          </p>
          {detectedLibraries.length > 0 && (
            <ul style={diagListStyle}>
              {detectedLibraries.map((lib, i) => (
                <li key={i} style={diagItemStyle}>
                  <strong>{lib.libraryName}</strong>
                  {lib.collectionName ? ` · ${lib.collectionName}` : ""}
                </li>
              ))}
            </ul>
          )}
          <p style={diagHintStyle}>
            Looking for any library whose name contains <code style={diagCodeStyle}>"hydrogen"</code>.
            If yours is named differently, tell Poseidon the actual name.
          </p>
        </div>
      )}

      <button type="button" style={primaryButtonStyle} onClick={onRecheck}>
        Re-check
      </button>
    </div>
  );
}

// ─── Inline styles (Figma plugins don't have CSS modules) ────────────────

const containerStyle: preact.JSX.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: 20,
  height: "100%",
  boxSizing: "border-box",
  justifyContent: "center",
  alignItems: "stretch",
};

const titleStyle: preact.JSX.CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
  margin: 0,
};

const bodyStyle: preact.JSX.CSSProperties = {
  fontSize: 13,
  lineHeight: 1.5,
  margin: 0,
  whiteSpace: "pre-wrap",
  color: "#444",
};

const mutedTextStyle: preact.JSX.CSSProperties = {
  fontSize: 12,
  color: "#888",
  marginTop: 12,
  textAlign: "center",
};

const errorTextStyle: preact.JSX.CSSProperties = {
  fontSize: 12,
  color: "#b42318",
  margin: 0,
};

const commandRowStyle: preact.JSX.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const codeStyle: preact.JSX.CSSProperties = {
  display: "block",
  padding: "10px 12px",
  background: "#f5f5f7",
  border: "1px solid #e5e5ea",
  borderRadius: 6,
  fontFamily: "SFMono-Regular, Menlo, Consolas, monospace",
  fontSize: 12,
  color: "#1e1e1e",
  whiteSpace: "pre",
  overflowX: "auto",
};

const buttonStyle: preact.JSX.CSSProperties = {
  alignSelf: "flex-start",
  padding: "6px 12px",
  background: "#ffffff",
  border: "1px solid #d0d0d5",
  borderRadius: 6,
  fontSize: 12,
  cursor: "pointer",
};

const primaryButtonStyle: preact.JSX.CSSProperties = {
  marginTop: 8,
  padding: "10px 16px",
  background: "#1e1e1e",
  color: "#ffffff",
  border: "none",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};

const linkStyle: preact.JSX.CSSProperties = {
  fontSize: 13,
  color: "#0066ff",
  textDecoration: "none",
};

const diagBoxStyle: preact.JSX.CSSProperties = {
  marginTop: 4,
  padding: 10,
  background: "#fafafc",
  border: "1px solid #eaeaee",
  borderRadius: 6,
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const diagTitleStyle: preact.JSX.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "#555",
  margin: 0,
};

const diagListStyle: preact.JSX.CSSProperties = {
  margin: 0,
  padding: 0,
  paddingLeft: 16,
  fontSize: 11,
  color: "#555",
  lineHeight: 1.5,
};

const diagItemStyle: preact.JSX.CSSProperties = {
  listStyle: "disc",
  marginBottom: 2,
};

const diagHintStyle: preact.JSX.CSSProperties = {
  margin: 0,
  fontSize: 11,
  color: "#888",
  lineHeight: 1.4,
};

const diagCodeStyle: preact.JSX.CSSProperties = {
  fontFamily: "SFMono-Regular, Menlo, monospace",
  background: "#eef0f3",
  padding: "0 4px",
  borderRadius: 3,
};

const spinnerDotStyle: preact.JSX.CSSProperties = {
  width: 24,
  height: 24,
  margin: "0 auto",
  borderRadius: "50%",
  border: "2px solid #e5e5ea",
  borderTopColor: "#1e1e1e",
  animation: "poseidon-spin 0.8s linear infinite",
};
