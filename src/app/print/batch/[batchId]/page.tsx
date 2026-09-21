import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { withUserContext } from "@/db/client";
import { getQrBatch, listQrCodesForBatch } from "@/lib/qr/batches";
import { getPartnerById } from "@/lib/partners/service";
import { generateQrSvg, publicQrUrl } from "@/lib/qr/asset";
import { PrintButton } from "@/components/admin/print-button";
import enMessages from "@/messages/en.json";
import kaMessages from "@/messages/ka.json";
import type { Locale } from "@/lib/i18n/config";

/**
 * Pilot-ready print sheet (Phase 4 §16) — one card per QR code: the QR
 * itself, a short CTA, and the owning Partner's name, sized and margined for
 * actual card printing. Authorization mirrors the CSV export route exactly
 * (withUserContext — RLS itself is what scopes qr_batches/partners access to
 * admin or the owning partner's own members; no separate check needed here).
 *
 * Deliberately renders in the PARTNER's own defaultLocale, not the viewing
 * admin/partner staff member's browser locale — print output should match
 * the audience the cards are handed to, not whoever clicked "print". This
 * intentionally renders inside the app's existing root layout/`<html lang>`
 * rather than a second one — Phase 4 is polish, not a routing restructure —
 * so the `lang` attribute reflects the viewer's locale even though the
 * visible copy below is the partner's; that's a cosmetic gap only.
 */
export default async function PrintBatchPage({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;

  const user = await getSessionUser();
  if (!user) redirect("/admin/login");

  const data = await withUserContext(user.id, async (tx) => {
    const batch = await getQrBatch(tx, batchId);
    if (!batch) return null;
    const partner = await getPartnerById(tx, batch.partnerId);
    const qrCodes = await listQrCodesForBatch(tx, batchId);
    return { batch, partner, qrCodes };
  });

  if (!data || !data.partner) notFound();
  const { partner, qrCodes } = data;

  const locale: Locale = partner.defaultLocale === "en" ? "en" : "ka";
  const messages = (locale === "en" ? enMessages : kaMessages).print;

  const cards = await Promise.all(
    qrCodes.map(async (qr) => ({
      token: qr.publicToken,
      url: publicQrUrl(qr.publicToken),
      svg: await generateQrSvg(qr.publicToken),
    })),
  );

  return (
    <div style={{ background: "#f5f5f5", fontFamily: "Georgia, serif", minHeight: "100vh" }}>
      <div className="print-toolbar" style={{ padding: "16px", textAlign: "center" }}>
        <PrintButton label={messages.printThisPage} />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(85mm, 1fr))",
          gap: "6mm",
          padding: "8mm",
        }}
      >
        {cards.map((card) => (
          <div
            key={card.token}
            className="print-card"
            style={{
              background: "#ffffff",
              border: "1px solid #000",
              borderRadius: "3mm",
              padding: "6mm",
              width: "85mm",
              height: "55mm",
              boxSizing: "border-box",
              display: "flex",
              alignItems: "center",
              gap: "5mm",
              breakInside: "avoid",
            }}
          >
            <div
              style={{ width: "40mm", height: "40mm", flexShrink: 0 }}
              // Server-generated SVG from the `qrcode` library (lib/qr/asset.ts) —
              // never user content, safe to embed directly.
              dangerouslySetInnerHTML={{ __html: card.svg }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: "2mm", minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: "11px", fontWeight: "bold", lineHeight: 1.3 }}>{messages.headline}</p>
              <p style={{ margin: 0, fontSize: "9px", color: "#444" }}>{messages.instruction}</p>
              <p style={{ margin: 0, fontSize: "8px", color: "#888" }}>{partner.name}</p>
            </div>
          </div>
        ))}
      </div>

      <style>{`
        @media print {
          .print-toolbar { display: none; }
          body { background: #fff; }
          .print-card { border-color: #000 !important; }
        }
      `}</style>
    </div>
  );
}
