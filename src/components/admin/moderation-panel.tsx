"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Flag, Search, ShieldCheck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Badge, EmptyState, control, table } from "@/components/dashboard/ui";
import { Button } from "@/components/ui/button";
import { lookupGreetingAction, blockGreetingAction, unblockGreetingAction } from "@/lib/moderation/actions";
import type { GreetingLookupResult } from "@/lib/moderation/service";

type Report = { id: string; greetingId: string; reason: string; details: string | null; createdAt: Date };
type StaleDraft = { greetingId: string; qrPublicToken: string; partnerName: string; createdAt: Date; updatedAt: Date };

const STATUS_TONE = { AVAILABLE: "neutral", DRAFT: "warning", ACTIVE: "success", BLOCKED: "danger" } as const;
type QrStatus = keyof typeof STATUS_TONE;

function useDateFormat() {
  const locale = useLocale();
  return (d: Date | string) =>
    new Date(d).toLocaleString(locale === "ka" ? "ka-GE" : "en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function GreetingCard({ result, onChanged, resolveReportId }: { result: GreetingLookupResult; onChanged: (fresh: GreetingLookupResult) => void; resolveReportId?: string }) {
  const t = useTranslations("admin.moderation");
  const tStatus = useTranslations("enums.qrStatus");
  const tCommon = useTranslations("common");
  const fmt = useDateFormat();
  const [confirmingBlock, setConfirmingBlock] = useState(false);
  const [confirmingUnblock, setConfirmingUnblock] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // blockGreetingAction/unblockGreetingAction return void on success, not the
  // updated row, so the card re-looks-up by the stable public token rather
  // than trusting router.refresh() alone — refresh() only re-renders server
  // components on this route and never touches this card's own useState,
  // which would otherwise keep showing the pre-action status until the admin
  // manually searched again.
  async function refetch() {
    const fresh = await lookupGreetingAction(result.qrPublicToken);
    if (fresh.ok && fresh.data) onChanged(fresh.data);
  }

  async function doBlock() {
    if (!reason.trim()) {
      setError(t("reasonRequired"));
      return;
    }
    setPending(true);
    setError(null);
    const res = await blockGreetingAction(result.greetingId, reason, resolveReportId);
    if (!res.ok) {
      setPending(false);
      setError(res.error);
      return;
    }
    setConfirmingBlock(false);
    setReason("");
    await refetch();
    setPending(false);
  }

  async function doUnblock() {
    if (!reason.trim()) {
      setError(t("reasonRequired"));
      return;
    }
    setPending(true);
    setError(null);
    const res = await unblockGreetingAction(result.greetingId, reason);
    if (!res.ok) {
      setPending(false);
      setError(res.error);
      return;
    }
    setConfirmingUnblock(false);
    setReason("");
    await refetch();
    setPending(false);
  }

  const rows: [string, string][] = [
    [t("themeLabel"), result.themeKey],
    [t("qrStatusLabel"), tStatus(result.qrStatus as QrStatus)],
    [t("createdLabel"), fmt(result.createdAt)],
    [t("updatedLabel"), fmt(result.updatedAt)],
    ...(result.activatedAt ? ([[t("activatedLabel"), fmt(result.activatedAt)]] as [string, string][]) : []),
    [t("paidOrderLabel"), result.hasPaidOrder ? t("paidOrderYes") : t("paidOrderNo")],
  ];

  return (
    <div className="rounded-[var(--radius-md)] bg-paper p-4 ring-1 ring-line" data-testid="moderation-result">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-body-sm tracking-wide break-all">{result.qrPublicToken}</p>
          <p className="text-caption text-ink-3">{result.partnerName}</p>
        </div>
        <span data-testid="moderation-status">
          <Badge tone={STATUS_TONE[result.status as QrStatus] ?? "neutral"}>{tStatus(result.status as QrStatus)}</Badge>
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-body-sm sm:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-caption text-ink-3">{label}</dt>
            <dd className="text-ink">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 border-t border-line pt-4">
        {result.status !== "BLOCKED" && !confirmingBlock && (
          <Button size="sm" variant="danger" onClick={() => setConfirmingBlock(true)} data-testid="moderation-block-start">
            {t("blockThisGreeting")}
          </Button>
        )}
        {result.status === "BLOCKED" && !confirmingUnblock && (
          <Button size="sm" variant="secondary" onClick={() => setConfirmingUnblock(true)} data-testid="moderation-unblock-start">
            {t("unblockThisGreeting")}
          </Button>
        )}

        {(confirmingBlock || confirmingUnblock) && (
          <div className="flex flex-col gap-3">
            <label htmlFor={`reason-${result.greetingId}`} className="text-caption font-medium text-ink-2">
              {t("reasonLabel")}
            </label>
            <textarea
              id={`reason-${result.greetingId}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className={`${control} h-auto py-2`}
              data-testid="moderation-reason-input"
            />
            {error && (
              <p className="text-caption text-danger" role="alert">
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={confirmingBlock ? doBlock : doUnblock}
                loading={pending}
                className={confirmingBlock ? "bg-danger hover:bg-danger" : ""}
                data-testid="moderation-confirm"
              >
                {confirmingBlock ? t("confirmBlock") : t("confirmUnblock")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setConfirmingBlock(false);
                  setConfirmingUnblock(false);
                  setReason("");
                  setError(null);
                }}
                data-testid="moderation-cancel"
              >
                {tCommon("cancel")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function ModerationSearch() {
  const t = useTranslations("admin.moderation");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<GreetingLookupResult | null | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    setPending(true);
    setError(null);
    const res = await lookupGreetingAction(query.trim());
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setResult(res.data);
  }

  return (
    <div className="flex flex-col gap-4" data-testid="moderation-search">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
        className="flex flex-col gap-2 sm:flex-row"
        role="search"
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            autoCapitalize="none"
            spellCheck={false}
            className={`${control} pl-9 font-mono`}
            data-testid="moderation-search-input"
          />
        </div>
        <Button type="submit" loading={pending} disabled={!query.trim()} data-testid="moderation-search-submit">
          {t("searchButton")}
        </Button>
      </form>
      {error && (
        <p className="text-caption text-danger" role="alert">
          {error}
        </p>
      )}
      {result === null && <p className="text-caption text-ink-3">{t("noResult")}</p>}
      {result && <GreetingCard result={result} onChanged={setResult} />}
    </div>
  );
}

export function OpenReportsList({ reports }: { reports: Report[] }) {
  const t = useTranslations("admin.moderation");
  const router = useRouter();
  const fmt = useDateFormat();
  const [lookups, setLookups] = useState<Record<string, GreetingLookupResult | null>>({});

  async function loadDetail(greetingId: string) {
    const res = await lookupGreetingAction(greetingId);
    if (res.ok) setLookups((prev) => ({ ...prev, [greetingId]: res.data }));
  }

  if (reports.length === 0) return <EmptyState icon={<ShieldCheck aria-hidden />} title={t("noOpenReports")} />;

  return (
    <ul className="divide-y divide-line">
      {reports.map((r) => (
        <li key={r.id} className="flex flex-col gap-3 p-5" data-testid="report-row">
          <div className="flex items-start gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-danger-soft text-danger">
              <Flag className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-body-sm font-medium text-ink">{r.reason}</p>
              {r.details && <p className="mt-0.5 text-body-sm text-ink-2">{r.details}</p>}
              <p className="mt-1 text-caption text-ink-3">{t("reported", { date: fmt(r.createdAt) })}</p>
            </div>
            {!lookups[r.greetingId] && (
              <Button size="sm" variant="secondary" onClick={() => loadDetail(r.greetingId)} data-testid="report-review">
                {t("review")}
              </Button>
            )}
          </div>
          {lookups[r.greetingId] && (
            <GreetingCard
              result={lookups[r.greetingId]!}
              onChanged={(fresh) => {
                setLookups((prev) => ({ ...prev, [r.greetingId]: fresh }));
                // A block here may also resolve this report — re-render the
                // server-rendered open-reports list so a resolved one drops out.
                router.refresh();
              }}
              resolveReportId={r.id}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

export function StaleDraftsList({ drafts }: { drafts: StaleDraft[] }) {
  const t = useTranslations("admin.moderation");
  const fmt = useDateFormat();
  if (drafts.length === 0) return <EmptyState title={t("noStaleDrafts")} />;
  return (
    <div className={table.wrap}>
      <table className={table.table}>
        <thead className={table.thead}>
          <tr>
            <th className={table.th}>{t("publicTokenHeader")}</th>
            <th className={table.th}>{t("partnerHeader")}</th>
            <th className={table.th}>{t("createdHeader")}</th>
            <th className={table.th}>{t("lastUpdatedHeader")}</th>
          </tr>
        </thead>
        <tbody>
          {drafts.map((d) => (
            <tr key={d.greetingId} className={table.tr} data-testid="stale-draft-row">
              <td className={`${table.td} font-mono text-caption`}>{d.qrPublicToken}</td>
              <td className={table.td}>{d.partnerName}</td>
              <td className={`${table.td} whitespace-nowrap text-ink-2`}>{fmt(d.createdAt)}</td>
              <td className={`${table.td} whitespace-nowrap text-ink-2`}>{fmt(d.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
