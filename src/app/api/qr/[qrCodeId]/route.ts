import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { checkIsAdmin, getPartnerRole, withPublicContext } from "@/db/client";
import { getQrCodeById } from "@/lib/qr/batches";
import { generateQrSvg, generateQrPng } from "@/lib/qr/asset";

/**
 * On-demand QR asset generation (Phase 1) — SVG (default, print-friendly
 * vector) or PNG, generated deterministically from the row's public_token,
 * never stored as a blob. qr_codes rows are publicly readable by RLS design
 * (public_token IS the public identity — see migrations/0001), but this
 * operational asset endpoint is still gated to admins and members of the
 * owning partner, since it's a print/ops tool, not a consumer-facing surface.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ qrCodeId: string }> }) {
  const { qrCodeId } = await params;
  const format = request.nextUrl.searchParams.get("format") === "png" ? "png" : "svg";

  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const qr = await withPublicContext((tx) => getQrCodeById(tx, qrCodeId));
  if (!qr) return new Response("Not found", { status: 404 });

  const isAdmin = await checkIsAdmin(user.id);
  if (!isAdmin) {
    const role = await getPartnerRole(user.id, qr.partnerId);
    if (!role) return new Response("Forbidden", { status: 403 });
  }

  if (format === "png") {
    const png = await generateQrPng(qr.publicToken);
    return new Response(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Disposition": `inline; filename="${qr.publicToken}.png"`,
      },
    });
  }

  const svg = await generateQrSvg(qr.publicToken);
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Disposition": `inline; filename="${qr.publicToken}.svg"`,
    },
  });
}
