"use client";

import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Badge, control, fieldLabel, table } from "@/components/dashboard/ui";
import { Button } from "@/components/ui/button";
import { formatMinorAmount } from "@/lib/format/money";
import { formatBusinessDate, formatBusinessPeriod, lastClosedBusinessDate } from "@/lib/business-calendar";

type DateLike = string | Date;

type PayoutItem = {
  ledgerEntryId: string;
  type: "COMMISSION_EARNED" | "COMMISSION_REVERSAL" | "ADJUSTMENT";
  amountMinor: number;
  bookedAt: DateLike;
  orderId: string | null;
  orderPaidAt: DateLike | null;
  grossAmountMinor: number | null;
  qrPublicToken: string | null;
  batchLabel: string | null;
  laterReversalMinor: number | null;
  laterReversalSettledByPayoutId: string | null;
};

type Payout = {
  id: string;
  amountMinor: number;
  currency: string;
  status: string;
  periodFrom: DateLike;
  periodTo: DateLike;
  reference: string | null;
  paidAt: DateLike | null;
  itemized: boolean;
  paidSalesCount: number;
  items: PayoutItem[];
};

type Candidate = {
  ledgerEntryId: string;
  type: PayoutItem["type"];
  amountMinor: number;
  bookedAt: DateLike;
  orderId: string | null;
  grossAmountMinor: number | null;
  qrPublicToken: string | null;
  batchLabel: string | null;
  state: "ELIGIBLE" | "CLAWBACK" | "REVERSED" | "PAID";
  paidByPayoutId: string | null;
};

type Statement = {
  paidActivations: number;
  grossSalesMinor: number;
  commissionEarnedMinor: number;
  commissionReversedMinor: number;
  netCommissionMinor: number;
  payableMinor: number;
  eligibleLedgerEntryIds: string[];
  reversedCount: number;
  alreadyPaidCount: number;
  candidates: Candidate[];
  blocker: "PERIOD_INVALID" | "PERIOD_NOT_CLOSED" | "PERIOD_OVERLAPS_PAYOUT" | "NOTHING_PAYABLE" | "EXCEEDS_BALANCE" | null;
};

type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Default period: the business month so far, up to the last CLOSED business
 * day (yesterday in the business timezone — not the browser's). Only a
 * convenience: the server re-derives "closed" itself and rejects anything else.
 */
function defaultPeriod(): { from: string; to: string; max: string } {
  const to = lastClosedBusinessDate();
  const from = `${to.slice(0, 8)}01`;
  return { from, to, max: to };
}

/**
 * Manual payout recording (Phase 5 §16, itemized since migrations/0014) —
 * accounting inside QR Starr, never a real bank transfer. The admin picks a
 * closed period, reviews the server's statement (the exact commissions that
 * would be paid) and confirms it; there is no free amount field. The
 * confirmation sends the statement's amount + row ids back, and the server
 * refuses if its own recomputation differs. Each recorded payout expands to
 * the exact sales it paid.
 */
export function PayoutManager({
  partnerId,
  currency,
  unpaidBalanceMinor,
  payouts,
  recordAction,
  statementAction,
}: {
  partnerId: string;
  currency: string;
  unpaidBalanceMinor: number;
  payouts: Payout[];
  recordAction: (partnerId: string, input: unknown) => Promise<ActionResult<{ payoutId: string }>>;
  statementAction: (partnerId: string, input: unknown) => Promise<ActionResult<Statement>>;
}) {
  const t = useTranslations("payoutManager");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const money = (minor: number, cur: string = currency) => formatMinorAmount(minor, cur, locale, { fixed: true });
  const fmt = (d: DateLike) => formatBusinessDate(d, locale);
  const initial = defaultPeriod();
  const [open, setOpen] = useState(false);
  const [periodFrom, setPeriodFrom] = useState(initial.from);
  const [periodTo, setPeriodTo] = useState(initial.to);
  const [reference, setReference] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !periodFrom || !periodTo) return;
    let cancelled = false;
    setStatement(null);
    statementAction(partnerId, { currency, periodFrom, periodTo }).then((result) => {
      if (cancelled) return;
      setStatement(result.ok ? result.data : null);
      setError(result.ok ? null : result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [open, statementAction, partnerId, currency, periodFrom, periodTo]);

  async function submit() {
    if (!statement) return;
    setPending(true);
    setError(null);
    const result = await recordAction(partnerId, {
      currency,
      periodFrom,
      periodTo,
      expectedAmountMinor: statement.payableMinor,
      expectedLedgerEntryIds: statement.eligibleLedgerEntryIds,
      reference: reference.trim() || undefined,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    setReference("");
    router.refresh();
  }

  const stateBadge = (c: Candidate) => {
    switch (c.state) {
      case "ELIGIBLE":
        return <Badge tone="success">{t("stateEligible")}</Badge>;
      case "CLAWBACK":
        return <Badge tone="warning">{t("stateClawback")}</Badge>;
      case "REVERSED":
        return <Badge>{t("stateReversed")}</Badge>;
      case "PAID":
        return <Badge tone="info">{t("statePaid")}</Badge>;
    }
  };

  const typeLabel = (type: PayoutItem["type"]) =>
    type === "COMMISSION_EARNED" ? t("typeCommission") : type === "COMMISSION_REVERSAL" ? t("typeReversal") : t("typeAdjustment");

  return (
    <div className="flex flex-col" data-testid="payout-manager">
      <div className="flex flex-wrap items-end justify-between gap-4 p-5">
        <div>
          <p className="text-caption text-ink-2">{t("unpaidBalance")}</p>
          <p className="mt-1 text-[1.75rem] leading-none font-medium tabular-nums" data-testid="payout-unpaid-balance">
            {money(unpaidBalanceMinor)}
          </p>
        </div>
        {!open && (
          <Button onClick={() => setOpen(true)} disabled={unpaidBalanceMinor <= 0} data-testid="payout-start">
            {t("recordButton")}
          </Button>
        )}
      </div>

      {open && (
        <div className="mx-5 mb-5 flex flex-col gap-4 rounded-[var(--radius-md)] bg-paper p-4 ring-1 ring-line" data-testid="payout-form">
          <p className="text-caption text-ink-2">{t("explainer")}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={fieldLabel}>
              {t("periodFrom")}
              <input type="date" value={periodFrom} max={initial.max} onChange={(e) => setPeriodFrom(e.target.value)} className={control} data-testid="payout-period-from" />
            </label>
            <label className={fieldLabel}>
              {t("periodTo")}
              <input type="date" value={periodTo} min={periodFrom} max={initial.max} onChange={(e) => setPeriodTo(e.target.value)} className={control} data-testid="payout-period-to" />
            </label>
            <label className={fieldLabel}>
              {t("referenceLabel")}
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder={t("referencePlaceholder")}
                className={control}
                data-testid="payout-reference"
              />
            </label>
          </div>

          {statement && (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-caption sm:grid-cols-3" data-testid="payout-statement">
                <div>
                  <dt className="text-ink-3">{t("statementActivations")}</dt>
                  <dd className="tabular-nums">{statement.paidActivations}</dd>
                </div>
                <div>
                  <dt className="text-ink-3">{t("statementGross")}</dt>
                  <dd className="tabular-nums">{money(statement.grossSalesMinor)}</dd>
                </div>
                <div>
                  <dt className="text-ink-3">{t("statementEarned")}</dt>
                  <dd className="tabular-nums">{money(statement.commissionEarnedMinor)}</dd>
                </div>
                <div>
                  <dt className="text-ink-3">{t("statementReversed")}</dt>
                  <dd className="tabular-nums">{money(statement.commissionReversedMinor)}</dd>
                </div>
                <div>
                  <dt className="text-ink-3">{t("statementRows")}</dt>
                  <dd className="tabular-nums">
                    {t("statementRowsValue", { eligible: statement.eligibleLedgerEntryIds.length, reversed: statement.reversedCount, paid: statement.alreadyPaidCount })}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-3">{t("statementPayable")}</dt>
                  <dd className="font-medium tabular-nums" data-testid="payout-statement-payable">
                    {money(statement.payableMinor)}
                  </dd>
                </div>
              </dl>

              {statement.candidates.length > 0 && (
                <div className={`${table.wrap} max-h-80 rounded-[var(--radius-sm)] bg-surface ring-1 ring-line`}>
                  <table className={table.table} data-testid="payout-candidates">
                    <thead className={table.thead}>
                      <tr>
                        <th className={table.th}>{t("colBooked")}</th>
                        <th className={table.th}>{t("colQr")}</th>
                        <th className={table.th}>{t("colOrder")}</th>
                        <th className={`${table.th} text-right`}>{t("colGross")}</th>
                        <th className={`${table.th} text-right`}>{t("colAmount")}</th>
                        <th className={table.th}>{t("colState")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statement.candidates.map((c) => (
                        <tr key={c.ledgerEntryId} className={table.tr} data-testid="payout-candidate-row" data-state={c.state}>
                          <td className={`${table.td} whitespace-nowrap text-ink-2`}>{fmt(c.bookedAt)}</td>
                          <td className={table.td}>
                            <span className="block font-mono text-caption">{c.qrPublicToken ?? typeLabel(c.type)}</span>
                            {c.batchLabel && <span className="block text-caption text-ink-3">{c.batchLabel}</span>}
                          </td>
                          <td className={`${table.td} font-mono text-caption`} title={c.orderId ?? undefined}>
                            {c.orderId ? c.orderId.slice(0, 8) : "—"}
                          </td>
                          <td className={`${table.td} text-right tabular-nums`}>{c.grossAmountMinor !== null ? money(c.grossAmountMinor) : "—"}</td>
                          <td className={`${table.td} text-right tabular-nums`}>{money(c.amountMinor)}</td>
                          <td className={table.td}>{stateBadge(c)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {statement.blocker && (
                <p className="text-caption text-danger" role="alert" data-testid="payout-blocker">
                  {t(`blocker.${statement.blocker}`)}
                </p>
              )}
            </>
          )}

          {error && (
            <p className="text-caption text-danger" role="alert" data-testid="payout-error">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={submit} loading={pending} disabled={!statement || statement.blocker !== null} data-testid="payout-confirm">
              {statement && !statement.blocker ? t("confirmButtonAmount", { amount: money(statement.payableMinor) }) : t("confirmButton")}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              data-testid="payout-cancel"
            >
              {tCommon("cancel")}
            </Button>
          </div>
        </div>
      )}

      <div className={`${table.wrap} border-t border-line`}>
        <table className={table.table}>
          <thead className={table.thead}>
            <tr>
              <th className={table.th}>{t("periodHeader")}</th>
              <th className={`${table.th} text-right`}>{t("amountHeader")}</th>
              <th className={table.th}>{t("itemsHeader")}</th>
              <th className={table.th}>{t("referenceHeader")}</th>
              <th className={table.th}>{t("paidHeader")}</th>
            </tr>
          </thead>
          <tbody>
            {payouts.map((p) => (
              <Fragment key={p.id}>
                <tr className={table.tr} data-testid="payout-row">
                  <td className={`${table.td} whitespace-nowrap`}>
                    {formatBusinessPeriod(p.periodFrom, p.periodTo, locale)}
                  </td>
                  <td className={`${table.td} text-right tabular-nums`}>{money(p.amountMinor, p.currency)}</td>
                  <td className={table.td}>
                    {p.itemized ? (
                      <button
                        type="button"
                        onClick={() => setExpanded(expanded === p.id ? null : p.id)}
                        aria-expanded={expanded === p.id}
                        className="text-caption text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink"
                        data-testid="payout-items-toggle"
                      >
                        {t("itemsCount", { sales: p.paidSalesCount, items: p.items.length })}
                      </button>
                    ) : (
                      <Badge>{t("legacy")}</Badge>
                    )}
                  </td>
                  <td className={`${table.td} text-ink-2`}>{p.reference ?? t("noReference")}</td>
                  <td className={`${table.td} whitespace-nowrap text-ink-2`}>{p.paidAt ? fmt(p.paidAt) : t("noReference")}</td>
                </tr>
                {expanded === p.id && (
                  <tr className="border-t border-line bg-paper" data-testid="payout-items">
                    <td colSpan={5} className="px-5 py-3">
                      <table className="w-full text-caption">
                        <thead className="text-left text-ink-3">
                          <tr>
                            <th className="py-1 pr-3 font-medium">{t("colBooked")}</th>
                            <th className="py-1 pr-3 font-medium">{t("colQr")}</th>
                            <th className="py-1 pr-3 font-medium">{t("colOrder")}</th>
                            <th className="py-1 pr-3 text-right font-medium">{t("colAmount")}</th>
                            <th className="py-1 font-medium">{t("colLaterRefund")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {p.items.map((i) => (
                            <tr key={i.ledgerEntryId} className="border-t border-line" data-testid="payout-item-row">
                              <td className="py-1.5 pr-3 whitespace-nowrap text-ink-2">{fmt(i.orderPaidAt ?? i.bookedAt)}</td>
                              <td className="py-1.5 pr-3">
                                <span className="font-mono">{i.qrPublicToken ?? typeLabel(i.type)}</span>
                                {i.batchLabel && <span className="ml-2 text-ink-3">{i.batchLabel}</span>}
                              </td>
                              <td className="py-1.5 pr-3 font-mono" title={i.orderId ?? undefined}>
                                {i.orderId ? i.orderId.slice(0, 8) : "—"}
                                {i.type === "COMMISSION_REVERSAL" && <span className="ml-2 font-sans text-ink-3">{typeLabel(i.type)}</span>}
                              </td>
                              <td className="py-1.5 pr-3 text-right tabular-nums">{money(i.amountMinor, p.currency)}</td>
                              <td className="py-1.5 text-ink-2">
                                {i.laterReversalMinor !== null
                                  ? i.laterReversalSettledByPayoutId
                                    ? t("laterRefundSettled", { amount: money(-i.laterReversalMinor, p.currency) })
                                    : t("laterRefundOpen", { amount: money(-i.laterReversalMinor, p.currency) })
                                  : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {payouts.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-center text-caption text-ink-3">
                  {t("noPayouts")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
