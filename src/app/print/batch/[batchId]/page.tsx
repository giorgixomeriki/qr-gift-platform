import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { withUserContext } from "@/db/client";
import { getQrBatch, listQrCodesForBatch } from "@/lib/qr/batches";
import { getPartnerById } from "@/lib/partners/service";
import { generateQrSvg, publicQrUrl } from "@/lib/qr/asset";
import { PrintButton } from "@/components/admin/print-button";
import { Logo } from "@/components/ui/logo";
import { SetHtmlLang } from "@/components/print/set-html-lang";
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
    <div className="min-h-dvh bg-sunken print:bg-white">
      <SetHtmlLang lang={locale} />
      <div className="print-toolbar sticky top-0 z-10 border-b border-line bg-surface/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="min-w-0">
            <p className="truncate text-label text-ink">{partner.name}</p>
            <p className="text-caption text-ink-3">{messages.cardCount.replace("{count}", String(cards.length))}</p>
          </div>
          <PrintButton label={messages.printThisPage} />
        </div>
      </div>

      <div className="print-sheet mx-auto grid max-w-5xl justify-center overflow-x-auto gap-[6mm] p-[8mm] [grid-template-columns:repeat(auto-fill,85mm)]">
        {cards.map((card) => (
          <div
            key={card.token}
            className="print-card flex h-[55mm] w-[85mm] break-inside-avoid items-center gap-[4mm] rounded-[3mm] bg-white p-[5mm] shadow-sm"
          >
            <div
              className="h-[42mm] w-[42mm] shrink-0 [&_svg]:h-full [&_svg]:w-full"
              // Server-generated SVG from the `qrcode` library (lib/qr/asset.ts) —
              // never user content, safe to embed directly.
              dangerouslySetInnerHTML={{ __html: card.svg }}
            />
            <div className="flex h-full min-w-0 flex-col justify-between py-[1mm]">
              <Logo className="text-[9pt]" />
              <div className="flex flex-col gap-[1.5mm]">
                <p className="font-serif text-[11pt] leading-[1.2] text-ink">{messages.headline}</p>
                <p className="text-[7pt] leading-snug text-ink-2">{messages.instruction}</p>
              </div>
              <p className="truncate text-[6.5pt] tracking-wide text-ink-3">{partner.name}</p>
            </div>
          </div>
        ))}
      </div>

      <style>{`
        @page { margin: 8mm; }
        @media print {
          .print-toolbar { display: none; }
          .print-sheet { padding: 0; max-width: none; }
          /* Hairline dashed cut guide instead of a heavy border. */
          .print-card { box-shadow: none !important; outline: 0.2mm dashed #c9c2b8; outline-offset: 0; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
    </div>
  );
}
