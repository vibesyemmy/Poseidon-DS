/**
 * Component picker — modal-ish overlay above the chat composer.
 *
 * Two-step UX:
 *   1. Search-filter list of all 179 DS components (grouped by category).
 *   2. Click a component → variant picker (one dropdown per variant property)
 *      → "Insert" submits a pre-baked prompt to Claude.
 *
 * For non-variant components, step 2 is skipped — clicking inserts immediately.
 */

import { useEffect, useMemo, useState } from "preact/hooks";

import { BridgeClient } from "../lib/bridgeClient.ts";

interface ComponentRow {
  key: string;
  name: string;
  category: string;
  isVariantSet: boolean;
  variants?: Record<string, string[]>;
  defaultVariantName?: string;
}

interface Props {
  bridge: BridgeClient;
  onPick: (prompt: string) => void;
  onClose: () => void;
}

export function ComponentPicker({ bridge, onPick, onClose }: Props): preact.JSX.Element {
  const [items, setItems] = useState<ComponentRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ComponentRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    bridge
      .listComponents()
      .then((r) => !cancelled && setItems(r.components))
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
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.category.toLowerCase().includes(q),
        )
      : items;
  }, [items, query]);

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <header style={headerStyle}>
          <strong style={titleStyle}>
            {selected ? `Configure: ${selected.name}` : "Insert a component"}
          </strong>
          <button type="button" onClick={onClose} style={closeStyle}>
            ✕
          </button>
        </header>

        {selected ? (
          <VariantPicker
            component={selected}
            onBack={() => setSelected(null)}
            onSubmit={(prompt) => onPick(prompt)}
          />
        ) : (
          <>
            <input
              type="text"
              placeholder="Search components…"
              value={query}
              autoFocus
              onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
              style={searchStyle}
            />
            <div style={listStyle}>
              {error && <p style={errorStyle}>{error}</p>}
              {!items && !error && <p style={mutedStyle}>Loading…</p>}
              {items && filtered.length === 0 && <p style={mutedStyle}>No matches.</p>}
              {filtered.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => {
                    if (c.isVariantSet) setSelected(c);
                    else onPick(`Insert the ${c.name} component (category: ${c.category}).`);
                  }}
                  style={rowStyle}
                >
                  <div style={rowMainStyle}>
                    <span style={rowNameStyle}>{c.name}</span>
                    <span style={rowMetaStyle}>
                      {c.category}
                      {c.isVariantSet && c.variants
                        ? ` · ${Object.keys(c.variants).length} variant prop${
                            Object.keys(c.variants).length === 1 ? "" : "s"
                          }`
                        : ""}
                    </span>
                  </div>
                  {c.isVariantSet && <span style={chevronStyle}>›</span>}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Variant picker — per-property dropdowns, defaults pre-selected from
 * `defaultVariantName`. Produces an "Insert X with variant {...}" prompt
 * and (when present) a separate textOverrides hint.
 */
function VariantPicker({
  component,
  onBack,
  onSubmit,
}: {
  component: ComponentRow;
  onBack: () => void;
  onSubmit: (prompt: string) => void;
}): preact.JSX.Element {
  const initialVariant = useMemo(() => parseDefaultVariant(component.defaultVariantName), [component]);
  const [vals, setVals] = useState<Record<string, string>>(initialVariant);
  const [label, setLabel] = useState("");

  return (
    <div style={variantWrapStyle}>
      <button type="button" onClick={onBack} style={backStyle}>
        ← Back
      </button>
      <div style={variantRowsStyle}>
        {component.variants &&
          Object.entries(component.variants).map(([prop, options]) => (
            <label key={prop} style={variantRowStyle}>
              <span style={variantLabelStyle}>{prop}</span>
              <select
                value={vals[prop] ?? options[0]}
                onChange={(e) =>
                  setVals((prev) => ({ ...prev, [prop]: (e.currentTarget as HTMLSelectElement).value }))
                }
                style={variantSelectStyle}
              >
                {options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
          ))}
        <label style={variantRowStyle}>
          <span style={variantLabelStyle}>Label text (optional)</span>
          <input
            type="text"
            placeholder='e.g. "Save changes"'
            value={label}
            onInput={(e) => setLabel((e.currentTarget as HTMLInputElement).value)}
            style={variantTextInputStyle}
          />
        </label>
      </div>
      <div style={submitRowStyle}>
        <button
          type="button"
          onClick={() => {
            const variantStr = Object.entries(vals)
              .map(([k, v]) => `${k}=${v}`)
              .join(", ");
            const textPart = label.trim()
              ? ` and label text "${label.trim()}"`
              : "";
            onSubmit(
              `Insert the ${component.name} component with variant { ${variantStr} }${textPart}.`,
            );
          }}
          style={submitButtonStyle}
        >
          Insert
        </button>
      </div>
    </div>
  );
}

/** "Type=Primary, Size=Small" → { Type: "Primary", Size: "Small" } */
function parseDefaultVariant(s?: string): Record<string, string> {
  if (!s) return {};
  const out: Record<string, string> = {};
  for (const pair of s.split(",")) {
    const eq = pair.indexOf("=");
    if (eq > 0) out[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return out;
}

// ─── styles ──────────────────────────────────────────────────────────────

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
  maxHeight: "80%",
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
  alignItems: "center",
  justifyContent: "space-between",
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
const chevronStyle: preact.JSX.CSSProperties = { color: "#888", fontSize: 16 };
const errorStyle: preact.JSX.CSSProperties = { fontSize: 12, color: "#b42318", margin: "8px 12px" };
const mutedStyle: preact.JSX.CSSProperties = { fontSize: 12, color: "#888", margin: "12px" };

const variantWrapStyle: preact.JSX.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  overflow: "hidden",
};
const backStyle: preact.JSX.CSSProperties = {
  background: "transparent",
  border: "none",
  textAlign: "left",
  padding: "10px 14px 4px",
  fontSize: 12,
  color: "#666",
  cursor: "pointer",
};
const variantRowsStyle: preact.JSX.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "0 14px 12px",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};
const variantRowStyle: preact.JSX.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
};
const variantLabelStyle: preact.JSX.CSSProperties = { fontSize: 11, color: "#666", fontWeight: 500 };
const variantSelectStyle: preact.JSX.CSSProperties = {
  padding: "6px 8px",
  fontSize: 12,
  border: "1px solid #d0d0d5",
  borderRadius: 6,
  background: "#ffffff",
};
const variantTextInputStyle: preact.JSX.CSSProperties = {
  padding: "6px 10px",
  fontSize: 12,
  border: "1px solid #d0d0d5",
  borderRadius: 6,
  outline: "none",
};
const submitRowStyle: preact.JSX.CSSProperties = {
  padding: "10px 14px 14px",
  borderTop: "1px solid #eaeaee",
};
const submitButtonStyle: preact.JSX.CSSProperties = {
  width: "100%",
  padding: "10px 16px",
  background: "#1e1e1e",
  color: "#ffffff",
  border: "none",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};
