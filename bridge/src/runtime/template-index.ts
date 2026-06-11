/**
 * STEP 2 — template index for the gate's `templates.suggest`.
 *
 * The 13 published variants live in `docs/design-system/03-templates.md`.
 * We mirror them here as a compact in-memory index with Use-when /
 * Don't-use-when lines, so the gate can rank them against a designer's
 * intent without round-tripping to the markdown.
 *
 * Keep this list in sync with:
 *   - docs/design-system/03-templates.md  (authoritative copy)
 *   - data/templates.json                 (slugs for insert_template)
 */

import type { VariantSummary } from "./session-state.ts";

type SeedVariant = Omit<VariantSummary, "score">;

const SEED: SeedVariant[] = [
  // List page family
  {
    variantKey: "page.list.kpis_and_table",
    recipeSlug: "list-page-with-kpis-and-table",
    name: "List page · With KPIs and table",
    family: "List",
    useWhen:
      "Primary destination after sign-in. KPI cards row + applied-filter chips + most-actioned dataset.",
    dontUseWhen: ">4 stat tiles needed. Page mixes Dashboard + Detail layout.",
  },
  {
    variantKey: "page.list.tabs_and_table",
    recipeSlug: "list-page-with-tabs-and-table",
    name: "List page · With tabs and table",
    family: "List",
    useWhen:
      "Browsing a single dataset with structured filtering — transactions, settlements, disputes, members.",
    dontUseWhen: "Filters >7 — switch to a side Filter panel.",
  },
  {
    variantKey: "page.list.empty_state",
    recipeSlug: "list-page-empty-state",
    name: "List page · Empty state",
    family: "List",
    useWhen:
      "List view has zero data — first-time use, after-filter-no-matches, after-archive.",
    dontUseWhen:
      "Error state. Writing 'No data' alone. Dropping the primary-action CTA.",
  },

  // Detail page family
  {
    variantKey: "page.detail.simple",
    recipeSlug: "detail-page-simple",
    name: "Detail page · Simple",
    family: "Detail",
    useWhen: "Focused detail view (single record) without status branching.",
    dontUseWhen:
      "Record has approval status (use Pending/Rejected). 2+ distinct content sections (use With tabs).",
  },
  {
    variantKey: "page.detail.with_tabs",
    recipeSlug: "detail-page-with-tabs",
    name: "Detail page · With tabs",
    family: "Detail",
    useWhen:
      "Detail surface has 2–5 distinct content sections that aren't visible simultaneously.",
    dontUseWhen: "Only 1 content section — collapse to Simple.",
  },
  {
    variantKey: "page.detail.pending",
    recipeSlug: "detail-page-pending",
    name: "Detail page · Pending",
    family: "Detail",
    useWhen:
      "Record awaiting external action (review, approval, processing). Pair with Status/Warning or Status/Info.",
    dontUseWhen: "Record was reviewed and rejected — use Rejected.",
  },
  {
    variantKey: "page.detail.rejected",
    recipeSlug: "detail-page-rejected",
    name: "Detail page · Rejected",
    family: "Detail",
    useWhen:
      "Record was reviewed and rejected. Pair with Status/Error badge + Alert for the reason.",
    dontUseWhen: "Record is pending or awaiting action — use Pending.",
  },
  {
    variantKey: "page.detail.confirmation_modal",
    recipeSlug: "detail-page-with-confirmation-modal",
    name: "Detail page · With confirmation modal",
    family: "Detail",
    useWhen:
      "State-changing action on the detail (Submit, Approve, Reject) needs explicit confirmation before commit.",
    dontUseWhen: "Action is reversible — skip the modal.",
  },

  // Form family
  {
    variantKey: "page.form.simple",
    recipeSlug: "form-simple",
    name: "Form · Simple",
    family: "Form",
    useWhen: "Creating a new entity with ≤ 6 fields, no grouping required.",
    dontUseWhen: "Fields need natural grouping — use Multi-section or Grouped.",
  },
  {
    variantKey: "page.form.multi_section",
    recipeSlug: "form-multi-section",
    name: "Form · Multi-section",
    family: "Form",
    useWhen:
      "Form has natural grouping (e.g. 3 batch limits) but is still a single submit.",
    dontUseWhen: "Groupings + sub-lists are needed — use Grouped.",
  },
  {
    variantKey: "page.form.grouped",
    recipeSlug: "form-grouped",
    name: "Form · Grouped",
    family: "Form",
    useWhen:
      "Form combines simple fields + an editable sub-list (approvers, recipients, rules).",
    dontUseWhen: "No sub-list — use Multi-section.",
  },
  {
    variantKey: "page.form.bulk_upload",
    recipeSlug: "form-bulk-upload",
    name: "Form · Bulk upload",
    family: "Form",
    useWhen:
      "Importing data from a file to seed an action (bulk dispute, bulk settlement, CSV import).",
    dontUseWhen:
      "Only a few records to seed manually — use Simple or Multi-section.",
  },
  {
    variantKey: "page.form.wizard",
    recipeSlug: "form-wizard",
    name: "Form · Wizard",
    family: "Form",
    useWhen:
      "Onboarding a new entity requiring multiple input groups across logical sections (KYC, new institution, approval ladder).",
    dontUseWhen:
      "Form has <6 fields total. Submit mid-wizard. Cancel without lose-data confirm modal.",
  },

  // Onboarding family
  {
    variantKey: "page.onboarding.login",
    recipeSlug: "onboarding-login",
    name: "Onboarding · Login",
    family: "Onboarding",
    useWhen: "Primary login flow.",
    dontUseWhen: "Login fails — use Login with error toast.",
  },
  {
    variantKey: "page.onboarding.login_error",
    recipeSlug: "onboarding-login-error-toast",
    name: "Onboarding · Login with error toast",
    family: "Onboarding",
    useWhen:
      "Representing the error state of login. Static template; production toast auto-dismisses.",
    dontUseWhen: "Mid-session error — use a non-onboarding error template.",
  },
  {
    variantKey: "page.onboarding.otp",
    recipeSlug: "onboarding-otp",
    name: "Onboarding · OTP",
    family: "Onboarding",
    useWhen:
      "Post-registration verification, 2FA login challenge, email-change confirmation.",
    dontUseWhen: "Mid-session step-up — use Settings · OTP-protected.",
  },

  // Settings family
  {
    variantKey: "page.settings.default",
    recipeSlug: "settings-default",
    name: "Settings · Default",
    family: "Settings",
    useWhen:
      "Settings/Admin pages where content reaches viewport edges (large tables, multi-section forms).",
    dontUseWhen:
      "A single configuration action needs OTP confirmation — use OTP-protected.",
  },
  {
    variantKey: "page.settings.otp_protected",
    recipeSlug: "settings-otp-protected",
    name: "Settings · OTP-protected",
    family: "Settings",
    useWhen:
      "In-app action requires step-up verification before commit — Activate MFA, rotate API keys, transfer ownership.",
    dontUseWhen:
      "Pre-auth OTP — use Onboarding · OTP. Don't auto-submit on last digit.",
  },
];

/**
 * Rank variants against an intent string.
 *
 * Simple bag-of-words scoring: split intent into tokens, count overlaps
 * with each variant's name + useWhen + family tag (case-insensitive,
 * stemmed lightly). Returns variants sorted by score desc.
 *
 * NOTE: this is a deterministic heuristic, not a model call. The gate uses
 * it to seed `templates.suggest`'s top-N for the model to choose from.
 */
export function rankByIntent(
  intent: string,
  limit = 5,
): VariantSummary[] {
  const tokens = (intent || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
  const tokenSet = new Set(tokens);

  // Family hint heuristics — keyword maps to family.
  const FAMILY_HINTS: Record<string, VariantSummary["family"]> = {
    login: "Onboarding",
    signin: "Onboarding",
    "sign-in": "Onboarding",
    otp: "Onboarding",
    register: "Onboarding",
    forgot: "Onboarding",
    setting: "Settings",
    settings: "Settings",
    admin: "Settings",
    detail: "Detail",
    record: "Detail",
    dispute: "Detail",
    transaction: "List",
    list: "List",
    table: "List",
    dashboard: "List",
    kpi: "List",
    empty: "List",
    form: "Form",
    create: "Form",
    new: "Form",
    upload: "Form",
    wizard: "Form",
    kyc: "Form",
  };

  let inferredFamily: VariantSummary["family"] | undefined;
  for (const tok of tokens) {
    if (FAMILY_HINTS[tok]) {
      inferredFamily = FAMILY_HINTS[tok];
      break;
    }
  }

  const scored: VariantSummary[] = SEED.map((v) => {
    const blob = (v.name + " " + v.useWhen + " " + v.family).toLowerCase();
    const blobTokens = blob.split(/[^a-z0-9]+/);
    let hits = 0;
    for (const t of blobTokens) if (tokenSet.has(t)) hits++;
    let score = hits / Math.max(1, tokens.length);
    if (inferredFamily && v.family === inferredFamily) score += 0.4;
    score = Math.max(0, Math.min(1, score));
    return { ...v, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/** Lookup by variantKey (exact match). */
export function getByVariantKey(variantKey: string): VariantSummary | null {
  const seed = SEED.find((s) => s.variantKey === variantKey);
  return seed ? { ...seed, score: 1 } : null;
}

/** Full registry — used by tests + audits. */
export function allVariants(): VariantSummary[] {
  return SEED.map((s) => ({ ...s, score: 1 }));
}
