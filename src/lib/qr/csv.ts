import "server-only";
import { publicQrUrl } from "./asset";

export type QrInventoryCsvRow = {
  publicToken: string;
  batchLabel: string;
  partnerName: string;
  status: string;
  distributionStatus: string;
};

/**
 * RFC 4180-style field escaping. A field is quoted whenever it contains a
 * comma, double quote, CR or LF; embedded quotes are doubled. This is what
 * makes Georgian text (which contains none of those delimiter characters but
 * may sit next to a partner/batch label that does) round-trip correctly in
 * Excel/Sheets/etc without ever corrupting the column structure.
 */
function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toRow(fields: string[]): string {
  return fields.map(escapeCsvField).join(",") + "\r\n";
}

/**
 * Print-ready variable-data export (Phase 1). Columns are deliberately
 * limited to what a print vendor / partner ops team actually needs — no
 * internal UUIDs (qr_codes.id, qr_batches.id, partners.id), no edit tokens,
 * no payment/commercial data. publicToken/publicUrl are the only identifiers,
 * and those are exactly what's already printed on the physical card.
 *
 * Leads with a UTF-8 BOM so Excel (which does not sniff encoding on CSV)
 * renders Georgian/other non-ASCII text correctly instead of mojibake.
 */
export function buildQrInventoryCsv(rows: QrInventoryCsvRow[]): string {
  const BOM = "﻿";
  const header = toRow(["publicToken", "publicUrl", "batch", "partner", "status", "distributionStatus"]);
  const body = rows
    .map((row) =>
      toRow([
        row.publicToken,
        publicQrUrl(row.publicToken),
        row.batchLabel,
        row.partnerName,
        row.status,
        row.distributionStatus,
      ]),
    )
    .join("");
  return BOM + header + body;
}
