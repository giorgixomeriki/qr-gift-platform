import { ChevronDown } from "lucide-react";
import { InventoryTable, type InventoryQrRow } from "./inventory-table";

type ActionResult = { ok: true } | { ok: false; error: string };

/** One QR batch as a collapsible panel — batches can hold thousands of codes, so only the newest starts open. */
export function BatchBlock({
  batch,
  qrCodes,
  countLabel,
  defaultOpen,
  markDistributedAction,
}: {
  batch: { id: string; label: string };
  qrCodes: InventoryQrRow[];
  countLabel: string;
  defaultOpen: boolean;
  markDistributedAction: (input: unknown) => Promise<ActionResult>;
}) {
  return (
    <details open={defaultOpen} className="group rounded-[var(--radius-lg)] bg-surface shadow-xs ring-1 ring-line" data-testid="batch-block">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-[var(--radius-lg)] px-5 py-4 hover:bg-paper [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block truncate text-h3">{batch.label}</span>
          <span className="text-caption text-ink-3">{countLabel}</span>
        </span>
        <ChevronDown className="size-5 shrink-0 text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-line pt-4">
        <InventoryTable batchId={batch.id} rows={qrCodes} markDistributedAction={markDistributedAction} />
      </div>
    </details>
  );
}
