import kaSite from "@/messages/site/ka.json";
import enSite from "@/messages/site/en.json";
import { locales, type Locale } from "@/lib/i18n/config";
import { policiesInEffect, resolveMerchantToken, tbilisiDate, type MerchantInfo } from "@/lib/merchant/info";
import { analyseSections, sectionsSchema } from "./document";

/**
 * Are the legal documents a buyer agrees to at checkout final AND in force?
 *
 * The same rules the policy pages use to say "In effect from …" rather than
 * "Not yet in effect" (components/site/document-page.tsx), applied to every
 * policy in every language:
 *   - no internal `review` (lawyer) or `decision` (owner) annotation is left
 *     in the copy;
 *   - every merchant detail the copy names is set;
 *   - LEGAL_EFFECTIVE_DATE is set, valid and has arrived in Georgia.
 * Real-money checkout must never open against a policy its own page labels a
 * draft. The answer is a pure function of the bundled copy, the env and the
 * clock; anything unexpected (unreadable copy, a parse error) counts as NOT
 * ready.
 */
export const CHECKOUT_POLICIES = ["terms", "privacy", "refunds"] as const;
export type CheckoutPolicy = (typeof CHECKOUT_POLICIES)[number];

export type LegalProblem =
  | { kind: "not_in_effect"; detail: "no_date" | "future_date" }
  | { kind: "annotations"; policy: CheckoutPolicy; locale: Locale; reviews: number; decisions: string[] }
  | { kind: "missing_merchant_detail"; policy: CheckoutPolicy; locale: Locale; tokens: string[] }
  | { kind: "unreadable"; policy: CheckoutPolicy | "*"; locale: Locale | "*"; message: string };

export type LegalReadiness = { ready: boolean; problems: LegalProblem[] };

type SiteCopy = Record<string, { lead?: unknown; sections?: unknown } | unknown>;
const COPY: Record<Locale, SiteCopy> = { ka: kaSite as SiteCopy, en: enSite as SiteCopy };

let testCopy: Record<Locale, SiteCopy> | null = null;

/**
 * Test suites only (payments suites that need an open checkout while the real
 * copy still carries notes). Refused in production, so it can never open a
 * live checkout; pass null to restore the bundled copy.
 */
export function setLegalCopyForTesting(copy: Record<Locale, SiteCopy> | null): void {
  if (process.env.NODE_ENV === "production") throw new Error("setLegalCopyForTesting is not available in production");
  testCopy = copy;
}

/** The bundled copy with every review/decision note removed — what "final" looks like, for tests. */
export function finalizedCopyForTesting(): Record<Locale, SiteCopy> {
  const strip = (site: SiteCopy): SiteCopy => {
    const out: SiteCopy = JSON.parse(JSON.stringify(site));
    for (const policy of CHECKOUT_POLICIES) {
      const doc = out[policy] as { sections?: { blocks?: { type?: string }[] }[] } | undefined;
      for (const section of doc?.sections ?? []) {
        section.blocks = (section.blocks ?? []).filter((b) => b.type !== "review" && b.type !== "decision");
        // A section that held only notes gets neutral test text (real final copy replaces the notes with text).
        if (section.blocks.length === 0) section.blocks = [{ type: "p", text: "Final text (test copy)." } as { type?: string }];
      }
    }
    return out;
  };
  return { ka: strip(COPY.ka), en: strip(COPY.en) };
}

export function legalReadiness(info: MerchantInfo, now: Date = new Date(), copy: Record<Locale, SiteCopy> = testCopy ?? COPY): LegalReadiness {
  const problems: LegalProblem[] = [];
  try {
    if (!policiesInEffect(info, now)) {
      problems.push({ kind: "not_in_effect", detail: info.values.legalEffectiveDate ? "future_date" : "no_date" });
    }
    for (const locale of locales) {
      for (const policy of CHECKOUT_POLICIES) {
        try {
          const doc = copy[locale]?.[policy] as { lead?: unknown; sections?: unknown } | undefined;
          if (!doc) throw new Error("policy copy missing");
          const sections = sectionsSchema.parse(doc.sections);
          const lead = typeof doc.lead === "string" ? [doc.lead] : [];
          const a = analyseSections(sections, lead);
          if (a.reviews > 0 || a.decisions.length > 0) {
            problems.push({ kind: "annotations", policy, locale, reviews: a.reviews, decisions: a.decisions });
          }
          const missing = a.merchantTokens.filter((tok) => resolveMerchantToken(info, tok, locale).value === null);
          if (missing.length > 0) problems.push({ kind: "missing_merchant_detail", policy, locale, tokens: missing });
        } catch (err) {
          problems.push({ kind: "unreadable", policy, locale, message: err instanceof Error ? err.message.slice(0, 120) : "error" });
        }
      }
    }
  } catch (err) {
    problems.push({ kind: "unreadable", policy: "*", locale: "*", message: err instanceof Error ? err.message.slice(0, 120) : "error" });
  }
  return { ready: problems.length === 0, problems };
}

/** Policy pages: "In effect from …" only when checkout would accept the same package. Any error = false. */
export function legalPackageInEffect(info: MerchantInfo, now: Date = new Date()): boolean {
  try {
    return legalReadiness(info, now).ready;
  } catch {
    return false;
  }
}

/** One line for logs / ops: never includes copy text or merchant values. */
export function describeLegalProblems(problems: LegalProblem[], now: Date = new Date()): string {
  return problems
    .map((p) => {
      switch (p.kind) {
        case "not_in_effect":
          return p.detail === "no_date" ? "LEGAL_EFFECTIVE_DATE unset" : `LEGAL_EFFECTIVE_DATE after today (${tbilisiDate(now)} Tbilisi)`;
        case "annotations":
          return `${p.locale}/${p.policy}: ${p.reviews} review + ${p.decisions.length} decision note(s) [${p.decisions.join(",")}]`;
        case "missing_merchant_detail":
          return `${p.locale}/${p.policy}: merchant detail(s) unset [${p.tokens.join(",")}]`;
        case "unreadable":
          return `${p.locale}/${p.policy}: unreadable (${p.message})`;
      }
    })
    .join("; ");
}
