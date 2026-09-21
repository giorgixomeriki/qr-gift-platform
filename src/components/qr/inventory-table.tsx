"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

type ActionResult = { ok: true } | { ok: false; error: string };

export type InventoryQrRow = {
  id: string;
  publicToken: string;
  status: string;
  distributionStatus: string;
};

/**
 * Per-batch inventory + distribution marking (Phase 1). Supports both a
 * lightweight single-row mark and a bulk "select all not-yet-distributed"
 * action — distribution is recorded as a deliberate confirmation, never
 * inferred from batch creation (see lib/qr/batches.ts markQrCodesDistributed).
 */
export function InventoryTable({
  batchId,
  rows,
  markDistributedAction,
}: {
  batchId: string;
  rows: InventoryQrRow[];
  markDistributedAction: (input: unknown) => Promise<ActionResult>;
}) {
  const t = useTranslations("inventoryTable");
  const tStatus = useTranslations("enums.qrStatus");
  const tDist = useTranslations("enums.distributionStatus");
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const undistributed = rows.filter((r) => r.distributionStatus === "NOT_DISTRIBUTED");

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function markSelected(ids: string[]) {
    if (ids.length === 0) return;
    setPending(true);
    setError(null);
    const result = await markDistributedAction({ qrCodeIds: ids });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSelected(new Set());
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3" data-testid="inventory-table">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending || selected.size === 0}
          onClick={() => markSelected([...selected])}
          className="rounded bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
          data-testid="mark-selected-distributed"
        >
          {t("markSelected", { count: selected.size })}
        </button>
        <button
          type="button"
          disabled={pending || undistributed.length === 0}
          onClick={() => markSelected(undistributed.map((r) => r.id))}
          className="rounded border border-neutral-300 px-3 py-1.5 text-xs font-medium disabled:opacity-40"
          data-testid="mark-all-distributed"
        >
          {t("markAll", { count: undistributed.length })}
        </button>
        <a
          href={`/api/qr/batches/${batchId}/export`}
          className="text-xs text-neutral-600 underline"
          data-testid="export-csv-link"
        >
          {t("exportCsv")}
        </a>
        <a
          href={`/print/batch/${batchId}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-neutral-600 underline"
          data-testid="print-batch-link"
        >
          {t("printCards")}
        </a>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-neutral-500">
            <th className="py-1" />
            <th className="py-1">{t("tokenHeader")}</th>
            <th className="py-1">{t("statusHeader")}</th>
            <th className="py-1">{t("distributionHeader")}</th>
            <th className="py-1">{t("assetHeader")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-neutral-200" data-testid="inventory-row">
              <td className="py-1">
                <input
                  type="checkbox"
                  checked={selected.has(row.id)}
                  disabled={row.distributionStatus === "DISTRIBUTED"}
                  onChange={() => toggle(row.id)}
                  data-testid="inventory-row-checkbox"
                />
              </td>
              <td className="py-1 font-mono text-xs">{row.publicToken}</td>
              <td className="py-1">{tStatus(row.status as "AVAILABLE" | "DRAFT" | "ACTIVE" | "BLOCKED")}</td>
              <td className="py-1">{tDist(row.distributionStatus as "NOT_DISTRIBUTED" | "DISTRIBUTED")}</td>
              <td className="py-1">
                <a href={`/api/qr/${row.id}?format=svg`} target="_blank" rel="noreferrer" className="text-xs underline">
                  {t("svgLink")}
                </a>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="py-2 text-xs text-neutral-500">
                {t("noCodes")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
