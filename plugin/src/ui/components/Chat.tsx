/**
 * Chat surface.
 *
 * Renders a message list + composer. Posts prompts to the bridge `/chat`
 * SSE endpoint, streams responses, and forwards tool requests to the
 * sandbox via postMessage. Tool results from the sandbox are POSTed back
 * to `/tool-response` so the bridge can hand them to the SDK.
 *
 * Phase 4.10-4.12.
 */

import { useEffect, useMemo, useReducer, useRef, useState } from "preact/hooks";

import { sendChat, postToolResponse, type ToolRequestEvent } from "../lib/chatClient.ts";
import { onSandbox, sendToSandbox } from "../lib/sandboxBridge.ts";
import { BridgeClient } from "../lib/bridgeClient.ts";
import { TemplatePicker } from "./TemplatePicker.tsx";
import { ComponentPicker } from "./ComponentPicker.tsx";

// STEP 3 — template-first UI (ENFORCEMENT.md)
import {
  composerReducer,
  initialComposerState,
} from "../state/composer.ts";
import { TemplateFirstPill } from "./TemplateFirstPill.tsx";
import { MatchedTemplateCard } from "./MatchedTemplateCard.tsx";
import { NoMatchCard } from "./NoMatchCard.tsx";
import { ComposeFromAtomsConfirmModal } from "./ComposeFromAtomsConfirmModal.tsx";
import type {
  NoMatchProposal,
  TemplateProposal,
} from "../../shared/messages.ts";
import { approveProposal } from "../../bridge/mutation-watcher.ts";
import { logAudit } from "../../audit/logger.ts";

interface AssistantTextBlock {
  kind: "assistant-text";
  text: string;
}
interface UserTextBlock {
  kind: "user-text";
  text: string;
}
interface ToolCallBlock {
  kind: "tool-call";
  toolUseId: string;
  name: string;
  input: unknown;
  output?: unknown;
  isError?: boolean;
}
interface AskUserBlock {
  kind: "ask-user";
  requestId: string;
  question: string;
  options?: string[];
  defaultOption?: string;
  answer?: string;
  cancelled?: boolean;
}
interface SystemNoteBlock {
  kind: "note";
  text: string;
}
type Block = AssistantTextBlock | UserTextBlock | ToolCallBlock | SystemNoteBlock | AskUserBlock;

interface Props {
  sessionId: string | null;
}

export function Chat({ sessionId }: Props): preact.JSX.Element {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const streamIdRef = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const bridgeRef = useRef(new BridgeClient());

  const [picker, setPicker] = useState<"templates" | "components" | null>(null);

  // STEP 3 — composer state machine for template-first UI.
  const [composer, dispatchComposer] = useReducer(composerReducer, initialComposerState);

  // Tick composer once a minute so TEMPLATE_FIRST_OFF_TEMPORARY auto-reverts.
  useEffect(() => {
    const t = setInterval(() => dispatchComposer({ type: "TICK", now: Date.now() }), 60_000);
    return () => clearInterval(t);
  }, []);

  // Detect gated-tool results in the message stream and drive the composer.
  useEffect(() => {
    if (blocks.length === 0) return;
    // Walk newest → oldest to find the latest interesting tool block.
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      if (b.kind !== "tool-call" || b.output === undefined) continue;
      const name = stripMcpPrefix(b.name);
      const out = b.output as { ok?: boolean; value?: unknown } | undefined;
      if (!out?.ok) continue;
      const val = out.value as Record<string, unknown> | undefined;
      const input = b.input as Record<string, unknown> | undefined;

      if (name === "templates_choose") {
        const variantKey = String(val?.variantKey ?? input?.variantKey ?? "");
        if (!variantKey) return;
        const proposal: TemplateProposal = {
          proposalId: b.toolUseId,
          intent: typeof input?.reason === "string" ? input.reason : "(no intent captured)",
          variantKey,
          variantName: String(val?.name ?? variantKey),
          family: detectFamilyFromKey(variantKey),
          useWhen: "(See 03-templates.md → Registry for full Use-when line.)",
          dontUseWhen: "(See 03-templates.md → Registry for full Don't-use-when line.)",
          score: 1,
        };
        dispatchComposer({ type: "PROPOSAL_MATCHED", proposal });
        return;
      }

      if (name === "escape_no_template_match") {
        const considered = Array.isArray(input?.considered) ? input.considered : [];
        const noMatch: NoMatchProposal = {
          proposalId: b.toolUseId,
          intent: String(input?.intent ?? "(no intent captured)"),
          rationale: String(input?.rationale ?? ""),
          considered: considered.slice(0, 3).map((c: Record<string, unknown>) => ({
            proposalId: String(c.variantKey ?? ""),
            intent: "",
            variantKey: String(c.variantKey ?? ""),
            variantName: String(c.name ?? c.variantKey ?? ""),
            family: (c.family as TemplateProposal["family"]) ?? "List",
            useWhen: String(c.useWhen ?? ""),
            dontUseWhen: String(c.dontUseWhen ?? ""),
            score: typeof c.score === "number" ? c.score : 0,
          })),
        };
        dispatchComposer({ type: "PROPOSAL_NO_MATCH", proposal: noMatch });
        return;
      }

      if (name === "screen_from_template" || name === "screen_compose_from_atoms") {
        dispatchComposer({ type: "MUTATION_COMPLETE" });
        return;
      }
    }
  }, [blocks]);

  // ─── Sandbox tool-result listener ────────────────────────────────────
  //
  // Posts the result back to the bridge so the SDK's tool handler can
  // resolve. We DON'T update the tool-call card here — the SDK will deliver
  // a `tool_result` in the next streamed message, and the `onMessage`
  // handler routes that into the card by `tool_use_id`. That keeps a
  // single source of truth for card state.
  useEffect(() => {
    return onSandbox("sandbox:tool-result", (msg) => {
      const sid = streamIdRef.current;
      if (!sid) return;
      void postToolResponse(sid, msg.requestId, msg.result);
    });
  }, []);

  // Auto-scroll on new blocks.
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [blocks.length]);

  const canSend = useMemo(() => input.trim().length > 0 && !streaming, [input, streaming]);

  // ─── Slash command dispatcher ────────────────────────────────────────
  async function runSlashCommand(raw: string): Promise<void> {
    const [cmd, ...rest] = raw.slice(1).split(/\s+/);
    setBlocks((prev) => [...prev, { kind: "user-text", text: raw }]);
    switch (cmd) {
      case "skills": {
        try {
          const res = await bridgeRef.current.listSkills();
          const lines = res.skills.length === 0
            ? "No skills loaded."
            : res.skills
                .map(
                  (s) =>
                    `• ${s.name} (${s.origin}, ${s.bodyChars} chars) — ${s.description}`,
                )
                .join("\n");
          const warn = res.warnings.length > 0
            ? `\n\nWarnings:\n${res.warnings.map((w) => `  ${w}`).join("\n")}`
            : "";
          setBlocks((prev) => [
            ...prev,
            { kind: "note", text: `Loaded skills (${res.count}):\n${lines}${warn}` },
          ]);
        } catch (e) {
          setBlocks((prev) => [
            ...prev,
            { kind: "note", text: `Failed to list skills: ${String((e as Error).message ?? e)}` },
          ]);
        }
        break;
      }
      case "clear":
        setBlocks([]);
        break;
      case "template": {
        const sub = rest[0];
        if (sub !== "save") {
          setBlocks((prev) => [
            ...prev,
            { kind: "note", text: "Usage: /template save  (captures the currently-selected node)" },
          ]);
          break;
        }
        // Hand off to Claude with a structured prompt. Claude will use
        // ask_user to confirm name + category, then call capture_template.
        setStreaming(true);
        setError(null);
        await sendChat({
          prompt:
            "The designer ran /template save. Use ask_user to confirm the template name, then the category (default 'Other'). " +
            "Then call capture_template with rootId omitted so it captures the current selection. " +
            "IMPORTANT: when capture_template returns, you MUST send a final assistant message in chat confirming: " +
            "the slug, the absolute file path, the node + child count, and a one-line note on any warnings. " +
            "Do not stay silent after the tool returns.",
          sessionId: sessionId ?? undefined,
          onMeta: (e) => {
            streamIdRef.current = e.streamId;
            sendToSandbox({ type: "ui:turn-start" });
          },
          onMessage: (m) => {
            // Same handling as regular send so the designer sees Claude's
            // assistant text + tool-call cards (incl. the final capture
            // confirmation).
            const msg = m as { type?: string; message?: { content?: unknown[] } };
            if (msg.type === "assistant" && msg.message?.content) {
              let text = "";
              const toolUses: Array<{ id: string; name: string; input: unknown }> = [];
              for (const block of msg.message.content as Array<Record<string, unknown>>) {
                if (block.type === "text" && typeof block.text === "string") text += block.text;
                else if (block.type === "tool_use") {
                  toolUses.push({
                    id: block.id as string,
                    name: block.name as string,
                    input: block.input,
                  });
                }
              }
              if (text) setBlocks((prev) => [...prev, { kind: "assistant-text", text }]);
              for (const tu of toolUses) {
                upsertToolCard(setBlocks, {
                  toolUseId: tu.id,
                  name: stripMcpPrefix(tu.name),
                  input: tu.input,
                });
              }
            }
            if (msg.type === "user" && msg.message?.content) {
              for (const block of msg.message.content as Array<Record<string, unknown>>) {
                if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
                  const text = extractToolResultText(block.content);
                  let parsed: unknown = text;
                  try {
                    parsed = text ? JSON.parse(text) : null;
                  } catch { /* leave as text */ }
                  const isError =
                    block.is_error === true ||
                    (parsed && typeof parsed === "object" && "error" in (parsed as Record<string, unknown>));
                  setBlocks((prev) =>
                    prev.map((b) =>
                      b.kind === "tool-call" && b.toolUseId === block.tool_use_id
                        ? { ...b, output: parsed, isError: !!isError }
                        : b,
                    ),
                  );
                }
              }
            }
          },
          onToolRequest: (e) => {
            if (e.tool === "ask_user") {
              const input = e.input as { question: string; options?: string[]; defaultOption?: string };
              setBlocks((prev) => [
                ...prev,
                {
                  kind: "ask-user",
                  requestId: e.requestId,
                  question: input.question,
                  options: input.options,
                  defaultOption: input.defaultOption,
                },
              ]);
              return;
            }
            sendToSandbox({ type: "ui:run-tool", requestId: e.requestId, tool: e.tool, input: e.input });
          },
          onDone: () => {
            setStreaming(false);
            streamIdRef.current = null;
            sendToSandbox({ type: "ui:turn-end" });
          },
          onError: (m) => {
            setError(m);
            setStreaming(false);
            streamIdRef.current = null;
            sendToSandbox({ type: "ui:turn-end" });
          },
        });
        break;
      }
      case "help":
        setBlocks((prev) => [
          ...prev,
          {
            kind: "note",
            text:
              "Slash commands:\n" +
              "  /template save   — capture current selection as a template\n" +
              "  /skills          — list loaded skills\n" +
              "  /clear           — clear the chat history\n" +
              "  /help            — this message",
          },
        ]);
        break;
      default:
        setBlocks((prev) => [
          ...prev,
          { kind: "note", text: `Unknown command: /${cmd}. Try /help.` },
        ]);
    }
    void rest; // reserved for argv later
  }

  // ─── ask_user answer/cancel handler ──────────────────────────────────
  const answerAsk = (requestId: string, answer: string, cancelled = false): void => {
    const sid = streamIdRef.current;
    if (!sid) return;
    void postToolResponse(sid, requestId, {
      ok: true,
      value: { answer, cancelled },
    });
    setBlocks((prev) =>
      prev.map((b) =>
        b.kind === "ask-user" && b.requestId === requestId
          ? { ...b, answer, cancelled }
          : b,
      ),
    );
  };

  async function send(): Promise<void> {
    const prompt = input.trim();
    if (!prompt || streaming) return;

    // Slash commands — handled locally, never sent to Claude.
    if (prompt.startsWith("/")) {
      setInput("");
      await runSlashCommand(prompt);
      return;
    }

    setInput("");
    setStreaming(true);
    setError(null);
    setBlocks((prev) => [...prev, { kind: "user-text", text: prompt }]);

    await sendChat({
      prompt,
      sessionId: sessionId ?? undefined,
      onMeta: (e) => {
        streamIdRef.current = e.streamId;
        // Mark turn boundary so the sandbox can group all of this turn's
        // canvas mutations into a single Cmd+Z entry.
        sendToSandbox({ type: "ui:turn-start" });
      },
      onMessage: (m) => {
        const msg = m as {
          type?: string;
          message?: { content?: unknown[] };
        };

        // Assistant text + tool_use blocks
        if (msg.type === "assistant" && msg.message?.content) {
          let text = "";
          const toolUses: Array<{ id: string; name: string; input: unknown }> = [];
          for (const block of msg.message.content as Array<Record<string, unknown>>) {
            if (block.type === "text" && typeof block.text === "string") {
              text += block.text;
            } else if (block.type === "tool_use") {
              toolUses.push({
                id: block.id as string,
                name: block.name as string,
                input: block.input,
              });
            }
          }
          if (text) {
            setBlocks((prev) => [...prev, { kind: "assistant-text", text }]);
          }
          // Add one card per tool_use, keyed by the SDK's tool_use_id. The
          // sandbox roundtrip will also fire onToolRequest with the SAME id
          // (bridge passes use_id through as requestId), so the dedupe in
          // upsertToolCard keeps this from creating duplicates.
          for (const tu of toolUses) {
            upsertToolCard(setBlocks, {
              toolUseId: tu.id,
              name: stripMcpPrefix(tu.name),
              input: tu.input,
            });
          }
        }

        // Tool results from Claude's perspective (bridge-only tools resolve here;
        // sandbox tools also surface their result this way after the round-trip).
        if (msg.type === "user" && msg.message?.content) {
          for (const block of msg.message.content as Array<Record<string, unknown>>) {
            if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
              const text = extractToolResultText(block.content);
              let parsed: unknown = text;
              try {
                parsed = text ? JSON.parse(text) : null;
              } catch {
                /* leave as text */
              }
              const isError =
                block.is_error === true ||
                (parsed && typeof parsed === "object" && "error" in (parsed as Record<string, unknown>));
              setBlocks((prev) =>
                prev.map((b) =>
                  b.kind === "tool-call" && b.toolUseId === block.tool_use_id
                    ? { ...b, output: parsed, isError: !!isError }
                    : b,
                ),
              );
            }
          }
        }
      },
      onToolRequest: (e: ToolRequestEvent) => {
        // ask_user is UI-only — render an interactive prompt instead of
        // forwarding to the sandbox. The card we render IS the interaction.
        if (e.tool === "ask_user") {
          const input = e.input as {
            question: string;
            options?: string[];
            defaultOption?: string;
          };
          setBlocks((prev) => [
            ...prev,
            {
              kind: "ask-user",
              requestId: e.requestId,
              question: input.question,
              options: input.options,
              defaultOption: input.defaultOption,
            },
          ]);
          return;
        }
        // Card was already created by the matching `tool_use` block in
        // onMessage. Here we only forward to the sandbox; the card flips
        // to "done" when the SDK delivers the tool_result on the next
        // message.
        sendToSandbox({ type: "ui:run-tool", requestId: e.requestId, tool: e.tool, input: e.input });
      },
      onDone: () => {
        setStreaming(false);
        streamIdRef.current = null;
        sendToSandbox({ type: "ui:turn-end" });
      },
      onError: (m) => {
        setError(m);
        setStreaming(false);
        streamIdRef.current = null;
        // Close the (possibly partial) turn into a history entry so the
        // designer can still undo whatever did land.
        sendToSandbox({ type: "ui:turn-end" });
      },
    });
  }

  return (
    <div style={containerStyle}>
      <header style={headerStyle}>
        <span style={brandStyle}>Poseidon</span>
        <span style={subBrandStyle}>Hydrogen Design Copilot</span>
      </header>

      <div ref={listRef} style={messageListStyle}>
        {blocks.length === 0 && (
          <div style={emptyStateStyle}>
            <p style={emptyTitleStyle}>What would you like to design?</p>
            <p style={emptyHintStyle}>
              Try: <em>"Insert the empty-state list page."</em>
            </p>
          </div>
        )}
        {blocks.map((b, i) => (
          <BlockView key={i} block={b} onAnswerAsk={answerAsk} />
        ))}
        {streaming && <div style={typingStyle}>…</div>}
        {error && <p style={errorStyle}>Error: {error}</p>}
      </div>

      {/* STEP 3 — Inline template-first cards rendered above composer */}
      {composer.phase === "AWAITING_DECISION" && composer.matched && (
        <MatchedTemplateCard
          proposal={composer.matched}
          defeatReflexive={false}
          onAccept={() => {
            approveProposal(composer.matched!.proposalId);
            void logAudit({
              timestamp: new Date().toISOString(),
              sessionId: sessionId ?? "unknown",
              intentText: composer.matched!.intent,
              proposedTemplateId: composer.matched!.proposalId,
              proposedVariant: composer.matched!.variantKey,
              decision: "accept",
              mutationProposalId: composer.matched!.proposalId,
            });
            dispatchComposer({ type: "ACCEPT" });
          }}
          onPickDifferent={() => dispatchComposer({ type: "PICK_DIFFERENT" })}
          onNoMatch={() => dispatchComposer({ type: "CANCEL" })}
        />
      )}
      {composer.phase === "AWAITING_DECISION" && composer.noMatch && (
        <NoMatchCard
          proposal={composer.noMatch}
          onUseAnyway={(variantKey) => {
            void logAudit({
              timestamp: new Date().toISOString(),
              sessionId: sessionId ?? "unknown",
              intentText: composer.noMatch!.intent,
              proposedVariant: variantKey,
              decision: "pick_different",
            });
            dispatchComposer({ type: "CANCEL" });
          }}
          onComposeFromAtoms={() => dispatchComposer({ type: "REQUEST_COMPOSE" })}
          onRefineIntent={() => dispatchComposer({ type: "CANCEL" })}
          onAddNewTemplate={() => dispatchComposer({ type: "CANCEL" })}
        />
      )}
      {composer.phase === "AWAITING_COMPOSE_CONFIRM" && composer.noMatch && (
        <ComposeFromAtomsConfirmModal
          overrideCount={composer.overrideCount}
          onConfirm={() => {
            approveProposal(composer.noMatch!.proposalId);
            void logAudit({
              timestamp: new Date().toISOString(),
              sessionId: sessionId ?? "unknown",
              intentText: composer.noMatch!.intent,
              decision: "compose_override",
              overrideReason: "designer typed CONFIRM",
              mutationProposalId: composer.noMatch!.proposalId,
            });
            dispatchComposer({ type: "CONFIRM_COMPOSE" });
          }}
          onCancel={() => dispatchComposer({ type: "CANCEL" })}
        />
      )}

      <footer style={composerStyle}>
        <div style={chipsRowStyle}>
          <TemplateFirstPill
            mode={composer.mode}
            modeRevertAt={composer.modeRevertAt}
            onToggleOff={() => dispatchComposer({ type: "TOGGLE_TEMPLATE_FIRST_OFF_30MIN" })}
            onToggleOn={() => dispatchComposer({ type: "TOGGLE_TEMPLATE_FIRST_ON" })}
          />
          <button
            type="button"
            style={chipStyle}
            onClick={() => setPicker("templates")}
            disabled={streaming}
          >
            + Template
          </button>
          <button
            type="button"
            style={chipStyle}
            onClick={() => setPicker("components")}
            disabled={streaming}
          >
            + Component
          </button>
        </div>
        <div style={composerRowStyle}>
          <textarea
            value={input}
            onInput={(e) => setInput((e.currentTarget as HTMLTextAreaElement).value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={streaming ? "Streaming…" : "Ask Poseidon…"}
            style={inputStyle}
            rows={2}
            disabled={streaming}
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!canSend}
            style={canSend ? sendButtonStyle : sendButtonDisabledStyle}
          >
            Send
          </button>
        </div>
      </footer>

      {picker === "templates" && (
        <TemplatePicker
          bridge={bridgeRef.current}
          onClose={() => setPicker(null)}
          onPick={(prompt) => {
            setPicker(null);
            setInput(prompt);
          }}
        />
      )}
      {picker === "components" && (
        <ComponentPicker
          bridge={bridgeRef.current}
          onClose={() => setPicker(null)}
          onPick={(prompt) => {
            setPicker(null);
            setInput(prompt);
          }}
        />
      )}
    </div>
  );
}

interface BlockViewProps {
  block: Block;
  onAnswerAsk: (requestId: string, answer: string, cancelled?: boolean) => void;
}

function BlockView({ block, onAnswerAsk }: BlockViewProps): preact.JSX.Element {
  if (block.kind === "user-text") {
    return (
      <div style={{ ...bubbleBaseStyle, ...userBubbleStyle }}>
        <span style={roleLabelStyle}>You</span>
        <p style={bubbleTextStyle}>{block.text}</p>
      </div>
    );
  }
  if (block.kind === "assistant-text") {
    return (
      <div style={{ ...bubbleBaseStyle, ...assistantBubbleStyle }}>
        <span style={roleLabelStyle}>Poseidon</span>
        <p style={bubbleTextStyle}>{block.text}</p>
      </div>
    );
  }
  if (block.kind === "note") {
    return <p style={noteStyle}>{block.text}</p>;
  }
  if (block.kind === "ask-user") {
    return <AskUserCard block={block} onAnswer={onAnswerAsk} />;
  }
  // tool-call
  return (
    <details style={toolCardStyle}>
      <summary style={toolSummaryStyle}>
        <code>{block.name}</code>
        {block.output === undefined ? (
          <span style={runningPillStyle}>running</span>
        ) : block.isError ? (
          <span style={errorPillStyle}>error</span>
        ) : (
          <span style={donePillStyle}>done</span>
        )}
      </summary>
      <div style={toolBodyStyle}>
        <div style={toolSectionTitleStyle}>input</div>
        <pre style={preStyle}>{JSON.stringify(block.input, null, 2)}</pre>
        {block.output !== undefined && (
          <>
            <div style={toolSectionTitleStyle}>output</div>
            <ToolOutputView output={block.output} />
          </>
        )}
      </div>
    </details>
  );
}

/**
 * Render a tool result. Detects known shapes (screenshots, large arrays)
 * and uses a friendlier display than raw JSON.
 */
function ToolOutputView({ output }: { output: unknown }): preact.JSX.Element {
  const screenshot = extractScreenshot(output);
  if (screenshot) {
    return (
      <div style={screenshotWrapStyle}>
        <img
          src={`data:image/${screenshot.format.toLowerCase()};base64,${screenshot.base64}`}
          alt={screenshot.nodeName ?? "screenshot"}
          style={screenshotImgStyle}
        />
        <div style={screenshotCaptionStyle}>
          {screenshot.nodeName ?? "node"} · {screenshot.width}×{screenshot.height} · {screenshot.format}
          {" · "}
          {Math.round(screenshot.byteLength / 1024)} KB
        </div>
      </div>
    );
  }
  return <pre style={preStyle}>{JSON.stringify(output, null, 2)}</pre>;
}

interface ScreenshotShape {
  base64: string;
  format: string;
  nodeName?: string;
  width: number;
  height: number;
  byteLength: number;
}

/**
 * Recognize a screenshot in the tool output. Three possible nestings:
 *   1. `{ base64, format, ... }`                     — sandbox direct
 *   2. `{ value: { base64, format, ... } }`         — wrapped in ok()
 *   3. Claude's tool_result envelope: a string that JSON-parses to either
 *      of the above.
 */
function extractScreenshot(output: unknown): ScreenshotShape | null {
  const peek = (o: unknown): ScreenshotShape | null => {
    if (!o || typeof o !== "object") return null;
    const obj = o as Record<string, unknown>;
    if (typeof obj.base64 === "string" && typeof obj.format === "string") {
      return {
        base64: obj.base64,
        format: obj.format,
        nodeName: typeof obj.nodeName === "string" ? obj.nodeName : undefined,
        width: typeof obj.width === "number" ? obj.width : 0,
        height: typeof obj.height === "number" ? obj.height : 0,
        byteLength: typeof obj.byteLength === "number" ? obj.byteLength : 0,
      };
    }
    if (obj.value) return peek(obj.value);
    return null;
  };
  // Direct or nested.
  const direct = peek(output);
  if (direct) return direct;
  // String form — Claude's tool_result.content[0].text is the JSON payload.
  if (typeof output === "string") {
    try {
      return peek(JSON.parse(output));
    } catch {
      return null;
    }
  }
  return null;
}

/** Interactive prompt rendered when Claude calls `ask_user`. */
function AskUserCard({
  block,
  onAnswer,
}: {
  block: AskUserBlock;
  onAnswer: (requestId: string, answer: string, cancelled?: boolean) => void;
}): preact.JSX.Element {
  const [draft, setDraft] = useState(block.defaultOption ?? "");
  const answered = block.answer !== undefined;

  return (
    <div style={askCardStyle}>
      <span style={askLabelStyle}>Poseidon asks</span>
      <p style={askQuestionStyle}>{block.question}</p>

      {answered ? (
        <div style={askAnswerStyle}>
          {block.cancelled ? <em style={askCancelStyle}>(cancelled)</em> : block.answer}
        </div>
      ) : block.options && block.options.length > 0 ? (
        <div style={askOptionsRowStyle}>
          {block.options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => onAnswer(block.requestId, opt)}
              style={
                opt === block.defaultOption
                  ? { ...askButtonStyle, ...askButtonDefaultStyle }
                  : askButtonStyle
              }
            >
              {opt}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onAnswer(block.requestId, "", true)}
            style={askCancelButtonStyle}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div style={askInputRowStyle}>
          <input
            type="text"
            value={draft}
            placeholder="Type your answer…"
            style={askInputStyle}
            onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft.trim()) {
                onAnswer(block.requestId, draft.trim());
              }
            }}
            autoFocus
          />
          <button
            type="button"
            disabled={!draft.trim()}
            onClick={() => onAnswer(block.requestId, draft.trim())}
            style={draft.trim() ? askSubmitButtonStyle : { ...askSubmitButtonStyle, ...askSubmitDisabledStyle }}
          >
            Send
          </button>
          <button
            type="button"
            onClick={() => onAnswer(block.requestId, "", true)}
            style={askCancelButtonStyle}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function detectFamilyFromKey(variantKey: string): TemplateProposal["family"] {
  if (variantKey.startsWith("page.list.")) return "List";
  if (variantKey.startsWith("page.detail.")) return "Detail";
  if (variantKey.startsWith("page.form.")) return "Form";
  if (variantKey.startsWith("page.onboarding.")) return "Onboarding";
  if (variantKey.startsWith("page.settings.")) return "Settings";
  return "List";
}

function stripMcpPrefix(name: string): string {
  return name.replace(/^mcp__[^_]+__/, "");
}

/**
 * Upsert a tool-call card by `toolUseId`. If a card with the same id
 * already exists, leave it alone (we don't want to overwrite output that
 * may have already arrived). Otherwise append a new "running" card.
 */
function upsertToolCard(
  setBlocks: (updater: (prev: Block[]) => Block[]) => void,
  card: { toolUseId: string; name: string; input: unknown },
): void {
  setBlocks((prev) => {
    if (prev.some((b) => b.kind === "tool-call" && b.toolUseId === card.toolUseId)) {
      return prev;
    }
    return [...prev, { kind: "tool-call", ...card }];
  });
}

/** SDK packs tool_result content as `string` or `Array<{ type: 'text'; text: string }>`. */
function extractToolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && typeof (b as { text?: unknown }).text === "string"
        ? (b as { text: string }).text
        : ""))
      .join("");
  }
  return "";
}

// ─── Styles ──────────────────────────────────────────────────────────────

const containerStyle: preact.JSX.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  boxSizing: "border-box",
};
const headerStyle: preact.JSX.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  padding: "14px 16px",
  borderBottom: "1px solid #eaeaee",
};
const brandStyle: preact.JSX.CSSProperties = { fontSize: 14, fontWeight: 600 };
const subBrandStyle: preact.JSX.CSSProperties = { fontSize: 11, color: "#888" };

const messageListStyle: preact.JSX.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};
const emptyStateStyle: preact.JSX.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  height: "100%",
  textAlign: "center",
  gap: 6,
};
const emptyTitleStyle: preact.JSX.CSSProperties = {
  fontSize: 14,
  fontWeight: 500,
  margin: 0,
  color: "#1e1e1e",
};
const emptyHintStyle: preact.JSX.CSSProperties = {
  fontSize: 12,
  color: "#888",
  margin: 0,
  lineHeight: 1.5,
};
const bubbleBaseStyle: preact.JSX.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #eaeaee",
};
const userBubbleStyle: preact.JSX.CSSProperties = { background: "#fafafc", alignSelf: "flex-end", maxWidth: "85%" };
const assistantBubbleStyle: preact.JSX.CSSProperties = { background: "#ffffff", alignSelf: "flex-start", maxWidth: "92%" };
const roleLabelStyle: preact.JSX.CSSProperties = { fontSize: 10, color: "#888", fontWeight: 600, textTransform: "uppercase" };
const bubbleTextStyle: preact.JSX.CSSProperties = { fontSize: 13, lineHeight: 1.5, margin: 0, whiteSpace: "pre-wrap" };

const noteStyle: preact.JSX.CSSProperties = { fontSize: 12, color: "#888", fontStyle: "italic", margin: "4px 0" };
const typingStyle: preact.JSX.CSSProperties = { fontSize: 14, color: "#888", padding: 4 };
const errorStyle: preact.JSX.CSSProperties = { fontSize: 12, color: "#b42318" };

const toolCardStyle: preact.JSX.CSSProperties = {
  background: "#f9f9fb",
  border: "1px solid #eaeaee",
  borderRadius: 8,
  fontSize: 12,
};
const toolSummaryStyle: preact.JSX.CSSProperties = {
  cursor: "pointer",
  padding: "8px 10px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  fontFamily: "SFMono-Regular, Menlo, monospace",
  fontSize: 12,
};
const toolBodyStyle: preact.JSX.CSSProperties = {
  padding: "8px 10px 10px",
  borderTop: "1px solid #eaeaee",
};
const toolSectionTitleStyle: preact.JSX.CSSProperties = {
  fontSize: 10,
  color: "#888",
  fontWeight: 600,
  textTransform: "uppercase",
  marginTop: 6,
};
const preStyle: preact.JSX.CSSProperties = {
  margin: "4px 0 0",
  padding: 8,
  background: "#ffffff",
  border: "1px solid #eaeaee",
  borderRadius: 4,
  fontSize: 11,
  fontFamily: "SFMono-Regular, Menlo, monospace",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
  maxHeight: 200,
  overflowY: "auto",
};
const runningPillStyle: preact.JSX.CSSProperties = {
  fontSize: 10,
  padding: "1px 6px",
  borderRadius: 8,
  background: "#fff7d6",
  color: "#8a6d00",
};
const donePillStyle: preact.JSX.CSSProperties = {
  fontSize: 10,
  padding: "1px 6px",
  borderRadius: 8,
  background: "#dcfae6",
  color: "#067647",
};
const errorPillStyle: preact.JSX.CSSProperties = {
  fontSize: 10,
  padding: "1px 6px",
  borderRadius: 8,
  background: "#fee4e2",
  color: "#b42318",
};

const screenshotWrapStyle: preact.JSX.CSSProperties = {
  marginTop: 4,
  display: "flex",
  flexDirection: "column",
  gap: 6,
  alignItems: "stretch",
};
const screenshotImgStyle: preact.JSX.CSSProperties = {
  width: "100%",
  height: "auto",
  maxHeight: 320,
  objectFit: "contain",
  borderRadius: 6,
  border: "1px solid #eaeaee",
  background:
    "repeating-conic-gradient(#f3f3f5 0% 25%, #ffffff 0% 50%) 50% / 12px 12px",
};
const screenshotCaptionStyle: preact.JSX.CSSProperties = {
  fontSize: 11,
  color: "#666",
  textAlign: "center",
};

const askCardStyle: preact.JSX.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: "12px 14px",
  border: "1px solid #ffd28a",
  background: "#fff7e6",
  borderRadius: 10,
};
const askLabelStyle: preact.JSX.CSSProperties = {
  fontSize: 10,
  color: "#8a5d00",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: 0.4,
};
const askQuestionStyle: preact.JSX.CSSProperties = {
  fontSize: 13,
  lineHeight: 1.5,
  margin: 0,
  color: "#1e1e1e",
  whiteSpace: "pre-wrap",
};
const askOptionsRowStyle: preact.JSX.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
};
const askInputRowStyle: preact.JSX.CSSProperties = {
  display: "flex",
  gap: 6,
};
const askInputStyle: preact.JSX.CSSProperties = {
  flex: 1,
  padding: "6px 10px",
  border: "1px solid #d0d0d5",
  borderRadius: 6,
  fontSize: 12,
  background: "#ffffff",
  outline: "none",
};
const askButtonStyle: preact.JSX.CSSProperties = {
  padding: "6px 10px",
  background: "#ffffff",
  border: "1px solid #d0d0d5",
  borderRadius: 6,
  fontSize: 12,
  cursor: "pointer",
};
const askButtonDefaultStyle: preact.JSX.CSSProperties = {
  background: "#1e1e1e",
  color: "#ffffff",
  borderColor: "#1e1e1e",
};
const askSubmitButtonStyle: preact.JSX.CSSProperties = {
  padding: "6px 12px",
  background: "#1e1e1e",
  color: "#ffffff",
  border: "none",
  borderRadius: 6,
  fontSize: 12,
  cursor: "pointer",
};
const askSubmitDisabledStyle: preact.JSX.CSSProperties = {
  background: "#cccccc",
  cursor: "not-allowed",
};
const askCancelButtonStyle: preact.JSX.CSSProperties = {
  padding: "6px 10px",
  background: "transparent",
  color: "#888",
  border: "none",
  fontSize: 12,
  cursor: "pointer",
  textDecoration: "underline",
};
const askAnswerStyle: preact.JSX.CSSProperties = {
  padding: "8px 10px",
  background: "#ffffff",
  border: "1px solid #eaeaee",
  borderRadius: 6,
  fontSize: 12,
};
const askCancelStyle: preact.JSX.CSSProperties = {
  color: "#888",
};

const composerStyle: preact.JSX.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: 12,
  borderTop: "1px solid #eaeaee",
};
const chipsRowStyle: preact.JSX.CSSProperties = {
  display: "flex",
  gap: 6,
};
const chipStyle: preact.JSX.CSSProperties = {
  padding: "4px 10px",
  fontSize: 11,
  background: "#f5f5f7",
  border: "1px solid #eaeaee",
  borderRadius: 999,
  cursor: "pointer",
  color: "#444",
};
const composerRowStyle: preact.JSX.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "flex-end",
};
const inputStyle: preact.JSX.CSSProperties = {
  flex: 1,
  padding: "8px 10px",
  border: "1px solid #d0d0d5",
  borderRadius: 8,
  fontSize: 13,
  fontFamily: "inherit",
  resize: "none",
  outline: "none",
  background: "#ffffff",
  color: "#1e1e1e",
};
const sendButtonStyle: preact.JSX.CSSProperties = {
  padding: "8px 14px",
  background: "#1e1e1e",
  color: "#ffffff",
  border: "none",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};
const sendButtonDisabledStyle: preact.JSX.CSSProperties = {
  ...sendButtonStyle,
  background: "#cccccc",
  cursor: "not-allowed",
};
