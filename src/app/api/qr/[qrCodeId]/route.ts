import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { checkIsAdmin, getPartnerRole, withPublicContext, withUserContext } from "@/db/client";
import { getQrCodeById } from "@/lib/qr/batches";
import { generateQrSvg, generateQrPng } from "@/lib/qr/asset";
import { isCredentialReleasable } from "@/lib/qr/credential-access";
import { recordAuditLog } from "@/lib/audit";

/**
 * On-demand QR asset generation (Phase 1) — SVG (default, print-friendly
 * vector) or PNG, generated deterministically from the row's public_token,
 * never stored as a blob. qr_codes rows are publicly readable by RLS design
 * (public_token IS the public identity — see migrations/0001), but this
 * operational asset endpoint is still gated to admins and members of the
 * owning partner, since it's a print/ops tool, not a consumer-facing surface.
 *
 * A partner gets the image only while the card is unclaimed — afterwards the
 * image IS the key to a greeting (lib/qr/credential-access.ts); 404 rather
 * than 403 so the response doesn't confirm the card's state. Never cached:
 * a long-lived browser cache would keep the credential around. Audit logged.
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
    if (!isCredentialReleasable("PARTNER", qr.status)) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  await withUserContext(user.id, (tx) =>
    recordAuditLog(tx, {
      actorType: isAdmin ? "ADMIN" : "PARTNER",
      actorId: user.id,
      action: "QR_ASSET_DOWNLOADED",
      targetType: "qr_code",
      targetId: qr.id,
      metadata: { partnerId: qr.partnerId, format },
    }),
  );

  if (format === "png") {
    const png = await generateQrPng(qr.publicToken);
    return new Response(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
        "Content-Disposition": `inline; filename="${qr.publicToken}.png"`,
      },
    });
  }

  const svg = await generateQrSvg(qr.publicToken);
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "no-store",
      "Content-Disposition": `inline; filename="${qr.publicToken}.svg"`,
    },
  });
}
