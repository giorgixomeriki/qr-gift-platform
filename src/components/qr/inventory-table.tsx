"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Printer, QrCode } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge, table } from "@/components/dashboard/ui";
import { Button, buttonClasses } from "@/components/ui/button";
import type { InventoryQrRow } from "@/lib/qr/credential-access";

type ActionResult = { ok: true } | { ok: false; error: string };

export type { InventoryQrRow };

const STATUS_TONE = { AVAILABLE: "neutral", USED: "info", DRAFT: "warning", ACTIVE: "success", BLOCKED: "danger" } as const;

/**
 * Per-batch inventory + distribution marking (Phase 1). Supports both a
 * lightweight single-row mark and a bulk "select all not-yet-distributed"
 * action — distribution is recorded as a deliberate confirmation, never
 * inferred from batch creation (see lib/qr/batches.ts markQrCodesDistributed).
 *
 * Rows arrive already shaped by lib/qr/credential-access.ts: a card whose
 * credential isn't released to this viewer has a masked label and no QR
 * asset link.
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
    <div className="flex flex-col" data-testid="inventory-table">
      <div className="flex flex-wrap items-center gap-2 px-5 pb-4">
        <Button
          size="sm"
          disabled={pending || selected.size === 0}
          onClick={() => markSelected([...selected])}
          data-testid="mark-selected-distributed"
        >
          {t("markSelected", { count: selected.size })}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={pending || undistributed.length === 0}
          onClick={() => markSelected(undistributed.map((r) => r.id))}
          data-testid="mark-all-distributed"
        >
          {t("markAll", { count: undistributed.length })}
        </Button>
        <span className="mx-1 hidden h-5 w-px bg-line sm:block" aria-hidden />
        <a href={`/api/qr/batches/${batchId}/export`} className={buttonClasses({ variant: "ghost", size: "sm" })} data-testid="export-csv-link">
          <Download className="size-4" aria-hidden />
          {t("exportCsv")}
        </a>
        <a
          href={`/print/batch/${batchId}`}
          target="_blank"
          rel="noreferrer"
          className={buttonClasses({ variant: "ghost", size: "sm" })}
          data-testid="print-batch-link"
        >
          <Printer className="size-4" aria-hidden />
          {t("printCards")}
        </a>
        {error && (
          <span className="text-caption text-danger" role="alert">
            {error}
          </span>
        )}
      </div>

      <div className={`${table.wrap} max-h-[28rem] overflow-y-auto`}>
        <table className={table.table}>
          <thead className={`${table.thead} sticky top-0 bg-surface`}>
            <tr>
              <th className={`${table.th} w-10`}>
                <span className="sr-only">{t("selectHeader")}</span>
              </th>
              <th className={table.th}>{t("tokenHeader")}</th>
              <th className={table.th}>{t("statusHeader")}</th>
              <th className={table.th}>{t("distributionHeader")}</th>
              <th className={table.th}>{t("assetHeader")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={table.tr} data-testid="inventory-row">
                <td className={table.td}>
                  <input
                    type="checkbox"
                    checked={selected.has(row.id)}
                    disabled={row.distributionStatus === "DISTRIBUTED"}
                    onChange={() => toggle(row.id)}
                    aria-label={row.label}
                    className="size-4 accent-[var(--ink)]"
                    data-testid="inventory-row-checkbox"
                  />
                </td>
                <td className={`${table.td} font-mono text-caption tracking-wide ${row.credentialReleased ? "" : "text-ink-3"}`} data-testid="inventory-row-label">
                  {row.label}
                </td>
                <td className={table.td}>
                  <Badge tone={STATUS_TONE[row.status as keyof typeof STATUS_TONE] ?? "neutral"}>
                    {tStatus(row.status)}
                  </Badge>
                </td>
                <td className={`${table.td} text-ink-2`}>{tDist(row.distributionStatus as "NOT_DISTRIBUTED" | "DISTRIBUTED")}</td>
                <td className={table.td}>
                  {row.credentialReleased ? (
                    <a
                      href={`/api/qr/${row.id}?format=svg`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-caption text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink"
                    >
                      <QrCode className="size-3.5" aria-hidden />
                      {t("svgLink")}
                    </a>
                  ) : (
                    <span className="text-caption text-ink-3">—</span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-center text-caption text-ink-3">
                  {t("noCodes")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
