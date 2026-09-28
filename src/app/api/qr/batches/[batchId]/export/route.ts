import { getSessionUser } from "@/lib/auth/session";
import { checkIsAdmin, withUserContext } from "@/db/client";
import { getQrBatch, listQrCodesForBatch, markExported } from "@/lib/qr/batches";
import { getPartnerById } from "@/lib/partners/service";
import { buildQrInventoryCsv } from "@/lib/qr/csv";
import { isCredentialReleasable, maskPublicToken, statusForViewer } from "@/lib/qr/credential-access";
import { recordAuditLog } from "@/lib/audit";

/**
 * Print-ready CSV export for one QR batch (Phase 1). Authorization is RLS
 * itself: withUserContext sets only app.user_id, and qr_batches_select /
 * partners_select independently require app_is_admin() or
 * app_is_partner_member(partner_id) for THIS batch's actual partner — so a
 * partner user can never export another partner's batch no matter what id is
 * in the URL, and no separate "is this my batch" check is needed here.
 *
 * Partners get credentials (token + URL) only for still-unclaimed cards;
 * claimed cards appear masked, with status USED (lib/qr/credential-access.ts).
 * Every export is audit logged with how many credentials it released.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;

  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const viewer = (await checkIsAdmin(user.id)) ? "ADMIN" : "PARTNER";

  const csv = await withUserContext(user.id, async (tx) => {
    const batch = await getQrBatch(tx, batchId);
    if (!batch) return null;

    const partner = await getPartnerById(tx, batch.partnerId);
    const qrCodes = await listQrCodesForBatch(tx, batchId);
    await markExported(tx, batchId);

    const rows = qrCodes.map((qr) => {
      const released = isCredentialReleasable(viewer, qr.status);
      return {
        publicToken: released ? qr.publicToken : maskPublicToken(qr.publicToken),
        publicUrl: released ? undefined : "",
        batchLabel: batch.label,
        partnerName: partner?.name ?? "",
        status: statusForViewer(viewer, qr.status),
        distributionStatus: qr.distributionStatus,
      };
    });

    await recordAuditLog(tx, {
      actorType: viewer,
      actorId: user.id,
      action: "QR_BATCH_EXPORTED",
      targetType: "qr_batch",
      targetId: batch.id,
      metadata: { partnerId: batch.partnerId, codes: rows.length, credentialsReleased: rows.filter((r) => r.publicUrl === undefined).length },
    });

    return buildQrInventoryCsv(rows);
  });

  if (csv === null) return new Response("Not found", { status: 404 });

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="qr-batch-${batchId}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
