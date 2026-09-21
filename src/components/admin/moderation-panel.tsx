"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { lookupGreetingAction, blockGreetingAction, unblockGreetingAction } from "@/lib/moderation/actions";
import type { GreetingLookupResult } from "@/lib/moderation/service";

type Report = { id: string; greetingId: string; reason: string; details: string | null; createdAt: Date };
type StaleDraft = { greetingId: string; qrPublicToken: string; partnerName: string; createdAt: Date; updatedAt: Date };

function fmt(d: Date | string) {
  return new Date(d).toLocaleString();
}

function GreetingCard({ result, onChanged, resolveReportId }: { result: GreetingLookupResult; onChanged: (fresh: GreetingLookupResult) => void; resolveReportId?: string }) {
  const t = useTranslations("admin.moderation");
  const tStatus = useTranslations("enums.qrStatus");
  const tCommon = useTranslations("common");
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

  return (
    <div className="rounded border border-neutral-800 p-4" data-testid="moderation-result">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-mono text-sm">{result.qrPublicToken}</p>
          <p className="text-xs text-neutral-500">{result.partnerName}</p>
        </div>
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${
            result.status === "BLOCKED" ? "bg-red-900 text-red-300" : result.status === "ACTIVE" ? "bg-emerald-900 text-emerald-300" : "bg-neutral-800 text-neutral-300"
          }`}
          data-testid="moderation-status"
        >
          {tStatus(result.status as "AVAILABLE" | "DRAFT" | "ACTIVE" | "BLOCKED")}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-neutral-400">
        <div>
          <dt className="text-neutral-600">{t("themeLabel")}</dt>
          <dd>{result.themeKey}</dd>
        </div>
        <div>
          <dt className="text-neutral-600">{t("qrStatusLabel")}</dt>
          <dd>
            {tStatus(result.qrStatus as "AVAILABLE" | "DRAFT" | "ACTIVE" | "BLOCKED")}
          </dd>
        </div>
        <div>
          <dt className="text-neutral-600">{t("createdLabel")}</dt>
          <dd>{fmt(result.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-neutral-600">{t("updatedLabel")}</dt>
          <dd>{fmt(result.updatedAt)}</dd>
        </div>
        {result.activatedAt && (
          <div>
            <dt className="text-neutral-600">{t("activatedLabel")}</dt>
            <dd>{fmt(result.activatedAt)}</dd>
          </div>
        )}
        <div>
          <dt className="text-neutral-600">{t("paidOrderLabel")}</dt>
          <dd>{result.hasPaidOrder ? t("paidOrderYes") : t("paidOrderNo")}</dd>
        </div>
      </dl>

      <p className="mt-3 text-[11px] italic text-neutral-600">{t("contentHiddenNote")}</p>

      <div className="mt-4">
        {result.status !== "BLOCKED" && !confirmingBlock && (
          <button type="button" onClick={() => setConfirmingBlock(true)} className="text-xs text-red-400 underline" data-testid="moderation-block-start">
            {t("blockThisGreeting")}
          </button>
        )}
        {result.status === "BLOCKED" && !confirmingUnblock && (
          <button type="button" onClick={() => setConfirmingUnblock(true)} className="text-xs text-emerald-400 underline" data-testid="moderation-unblock-start">
            {t("unblockThisGreeting")}
          </button>
        )}

        {(confirmingBlock || confirmingUnblock) && (
          <div className="mt-2 flex flex-col gap-2 rounded border border-neutral-700 p-3">
            <label htmlFor={`reason-${result.greetingId}`} className="text-xs text-neutral-400">
              {t("reasonLabel")}
            </label>
            <textarea
              id={`reason-${result.greetingId}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="rounded border border-neutral-700 bg-neutral-900 p-2 text-xs"
              data-testid="moderation-reason-input"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={confirmingBlock ? doBlock : doUnblock}
                disabled={pending}
                className={`rounded px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${confirmingBlock ? "bg-red-700 text-white" : "bg-emerald-700 text-white"}`}
                data-testid="moderation-confirm"
              >
                {pending ? "…" : confirmingBlock ? t("confirmBlock") : t("confirmUnblock")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmingBlock(false);
                  setConfirmingUnblock(false);
                  setReason("");
                  setError(null);
                }}
                className="rounded border border-neutral-700 px-3 py-1.5 text-xs"
                data-testid="moderation-cancel"
              >
                {tCommon("cancel")}
              </button>
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
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
    const res = await lookupGreetingAction(query);
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
        className="flex gap-2"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="w-80 rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm"
          data-testid="moderation-search-input"
        />
        <button type="submit" disabled={pending || !query.trim()} className="rounded bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 disabled:opacity-50" data-testid="moderation-search-submit">
          {pending ? "…" : t("searchButton")}
        </button>
      </form>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {result === null && <p className="text-xs text-neutral-500">{t("noResult")}</p>}
      {result && <GreetingCard result={result} onChanged={setResult} />}
    </div>
  );
}

export function OpenReportsList({ reports }: { reports: Report[] }) {
  const t = useTranslations("admin.moderation");
  const router = useRouter();
  const [lookups, setLookups] = useState<Record<string, GreetingLookupResult | null>>({});

  async function loadDetail(greetingId: string) {
    const res = await lookupGreetingAction(greetingId);
    if (res.ok) setLookups((prev) => ({ ...prev, [greetingId]: res.data }));
  }

  if (reports.length === 0) return <p className="text-xs text-neutral-500">{t("noOpenReports")}</p>;

  return (
    <div className="flex flex-col gap-3">
      {reports.map((r) => (
        <div key={r.id} className="rounded border border-neutral-800 p-3" data-testid="report-row">
          <p className="text-sm">{r.reason}</p>
          {r.details && <p className="mt-1 text-xs text-neutral-500">{r.details}</p>}
          <p className="mt-1 text-[11px] text-neutral-600">{t("reported", { date: fmt(r.createdAt) })}</p>
          {!lookups[r.greetingId] ? (
            <button type="button" onClick={() => loadDetail(r.greetingId)} className="mt-2 text-xs underline" data-testid="report-review">
              {t("review")}
            </button>
          ) : (
            <div className="mt-2">
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
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function StaleDraftsList({ drafts }: { drafts: StaleDraft[] }) {
  const t = useTranslations("admin.moderation");
  if (drafts.length === 0) return <p className="text-xs text-neutral-500">{t("noStaleDrafts")}</p>;
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left uppercase text-neutral-500">
          <th className="py-1">{t("publicTokenHeader")}</th>
          <th className="py-1">{t("partnerHeader")}</th>
          <th className="py-1">{t("createdHeader")}</th>
          <th className="py-1">{t("lastUpdatedHeader")}</th>
        </tr>
      </thead>
      <tbody>
        {drafts.map((d) => (
          <tr key={d.greetingId} className="border-t border-neutral-800" data-testid="stale-draft-row">
            <td className="py-1.5 font-mono">{d.qrPublicToken}</td>
            <td className="py-1.5">{d.partnerName}</td>
            <td className="py-1.5">{fmt(d.createdAt)}</td>
            <td className="py-1.5">{fmt(d.updatedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
