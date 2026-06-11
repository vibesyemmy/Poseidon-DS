/**
 * STEP 1 of the template-first enforcement plan (see ENFORCEMENT.md).
 *
 * This hard rule is appended LAST to the SDK system prompt so it has the
 * strongest recency weight against long conversation histories.
 *
 * Companion: bridge/src/templateCheck.ts — preamble validator + audit log.
 */

export const TEMPLATE_FIRST_RULE = [
  "# TEMPLATE-FIRST HARD RULE — NON-NEGOTIABLE",
  "",
  "Before any screen-creation tool call (insert_template, insert_component, emit_recipe, modify_node when it adds new structure), you MUST:",
  "",
  "1. Emit \"Template check: <intent> -> <variantKey|none>\" as the FIRST line of your assistant turn.",
  "     <intent> = short paraphrase of the designer's request.",
  "     <variantKey> = chosen template variant slug, or the literal \"none\" if nothing matched.",
  "2. Call list_templates first to confirm the chosen variant exists. Use 03-templates.md to map intent → family → variant.",
  "3. If <variantKey> is \"none\": call ask_user with the parsed intent, the 2–3 closest candidates considered, and the Use-when / Don't-use-when lines that rejected each. WAIT for express instruction. Never silent-compose.",
  "4. NEVER call emit_recipe or modify_node to fabricate a screen from scratch without an express instruction following a no-match.",
  "",
  "Every screen-creation turn is logged to ~/.poseidon/audit.jsonl. Violations (missing preamble, silent compose, skipped no-match dialog) are tracked. STEP 2 of the enforcement plan turns these warnings into a hard tool-gate.",
].join("\n");
