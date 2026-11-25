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
 * unset rather than marked, since leaving them out claims nothing; required
 * rows always show, with a "not yet published" marker when missing.
 */
export async function MerchantDetails({ ctx, compact = false }: { ctx: SiteContext; compact?: boolean }) {
  const t = await getTranslations("site.merchant");
  const rows = ROWS.filter((r) => !r.optional || resolveMerchantToken(ctx.merchant, r.token, ctx.locale).value !== null);
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
