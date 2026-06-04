/**
 * Template picker — modal-ish overlay above the chat composer.
 *
 * Lists all 18 DS templates with search. Clicking one calls `onPick` with
 * a pre-baked prompt the Chat composer drops into the input.
 */

import { useEffect, useMemo, useState } from "preact/hooks";

import { BridgeClient } from "../lib/bridgeClient.ts";

interface TemplateRow {
  slug: string;
  name: string;
  category: string;
  width: number;
  height: number;
}

interface Props {
  bridge: BridgeClient;
  onPick: (prompt: string) => void;
  onClose: () => void;
}

export function TemplatePicker({ bridge, onPick, onClose }: Props): preact.JSX.Element {
  const [items, setItems] = useState<TemplateRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    bridge
      .listTemplates()
      .then((r) => {
        if (!cancelled) setItems(r.templates);
      })
      .catch((e) => !cancelled && setError(String((e as Error).message ?? e)));
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  const filtered = useMemo(() => {
    if (!items) return [];
    const q = query.trim().toLowerCase();
    return q
      ? items.filter(
          (t) =>
            t.name.toLowerCase().includes(q) ||
            t.category.toLowerCase().includes(q) ||
            t.slug.includes(q),
        )
      : items;
  }, [items, query]);

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <header style={headerStyle}>
          <strong style={titleStyle}>Insert a template</strong>
          <button type="button" onClick={onClose} style={closeStyle}>
            ✕
          </button>
        </header>
        <input
          type="text"
          placeholder="Search templates…"
          value={query}
          autoFocus
          onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
          style={searchStyle}
        />
        <div style={listStyle}>
          {error && <p style={errorStyle}>{error}</p>}
          {!items && !error && <p style={mutedStyle}>Loading…</p>}
          {items && filtered.length === 0 && <p style={mutedStyle}>No matches.</p>}
          {filtered.map((t) => (
            <button
              key={t.slug}
              type="button"
              onClick={() => onPick(`Insert the "${t.name}" template.`)}
              style={rowStyle}
            >
              <div style={rowMainStyle}>
                <span style={rowNameStyle}>{t.name}</span>
                <span style={rowMetaStyle}>
                  {t.category} · {t.width}×{t.height}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const overlayStyle: preact.JSX.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.35)",
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "center",
  zIndex: 100,
};
const panelStyle: preact.JSX.CSSProperties = {
  width: "100%",
  maxHeight: "75%",
  background: "#ffffff",
  borderTopLeftRadius: 12,
  borderTopRightRadius: 12,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  boxShadow: "0 -8px 24px rgba(0,0,0,0.12)",
};
const headerStyle: preact.JSX.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "12px 14px",
  borderBottom: "1px solid #eaeaee",
};
const titleStyle: preact.JSX.CSSProperties = { fontSize: 13 };
const closeStyle: preact.JSX.CSSProperties = {
  background: "transparent",
  border: "none",
  fontSize: 14,
  cursor: "pointer",
  color: "#888",
};
const searchStyle: preact.JSX.CSSProperties = {
  margin: 12,
  padding: "8px 10px",
  fontSize: 12,
  border: "1px solid #d0d0d5",
  borderRadius: 6,
  outline: "none",
};
const listStyle: preact.JSX.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "0 6px 12px",
  display: "flex",
  flexDirection: "column",
  gap: 4,
};
const rowStyle: preact.JSX.CSSProperties = {
  display: "flex",
  padding: "8px 10px",
  background: "transparent",
  border: "1px solid transparent",
  borderRadius: 6,
  cursor: "pointer",
  textAlign: "left",
};
const rowMainStyle: preact.JSX.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
};
const rowNameStyle: preact.JSX.CSSProperties = { fontSize: 13, fontWeight: 500, color: "#1e1e1e" };
const rowMetaStyle: preact.JSX.CSSProperties = { fontSize: 11, color: "#888" };
const errorStyle: preact.JSX.CSSProperties = { fontSize: 12, color: "#b42318", margin: "8px 12px" };
const mutedStyle: preact.JSX.CSSProperties = { fontSize: 12, color: "#888", margin: "12px" };
