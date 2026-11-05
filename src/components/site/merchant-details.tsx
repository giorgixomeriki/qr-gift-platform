import { getTranslations } from "next-intl/server";
import { resolveMerchantToken, type MerchantToken } from "@/lib/merchant/info";
import { Inline } from "./inline";
import type { SiteContext } from "./context";

const ROWS: { token: MerchantToken; label: string; optional?: boolean }[] = [
  { token: "legalName", label: "legalName" },
  { token: "entityType", label: "entityType" },
  { token: "idCode", label: "idCode" },
  { token: "legalAddress", label: "legalAddress" },
  { token: "actualAddress", label: "actualAddress", optional: true },
  { token: "supportEmail", label: "email" },
  { token: "phone", label: "phone" },
  { token: "supportHours", label: "hours", optional: true },
];

/**
 * The merchant's registered identity and contact details as a definition
 * list. Optional rows (actual address, support hours) are omitted when
 * unset rather than marked, since leaving them out claims nothing. On the
 * public site a required row that is not set is left out too (audit UX-01);
 * only review mode (SITE_REVIEW_MARKERS=1) marks it.
 */
export async function MerchantDetails({ ctx, compact = false }: { ctx: SiteContext; compact?: boolean }) {
  const t = await getTranslations("site.merchant");
  const set = (r: (typeof ROWS)[number]) => resolveMerchantToken(ctx.merchant, r.token, ctx.locale).value !== null;
  // Public: only the details that are set. Review mode: required rows show their "not yet published" marker.
  const rows = ROWS.filter((r) => set(r) || (ctx.review && !r.optional));
  if (rows.length === 0) return null;
  return (
    <dl className={compact ? "space-y-1.5 text-body-sm" : "divide-y divide-line text-body"} data-testid="merchant-details">
      {rows.map((r) => (
        <div key={r.token} className={compact ? "flex flex-wrap gap-x-1.5" : "grid gap-1 py-3.5 sm:grid-cols-[12rem_1fr] sm:gap-6"}>
          <dt className={compact ? "text-ink-3" : "text-body-sm text-ink-3"}>
            {t(r.label)}
            {compact ? ":" : ""}
          </dt>
          <dd className="min-w-0 break-words text-ink">
            <Inline text={`{{merchant.${r.token}}}`} ctx={ctx} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
