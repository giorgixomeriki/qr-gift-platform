import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { getSessionUser } from "@/lib/auth/session";
import {
  listMyPartnerMembershipsWithNames,
  requirePartnerContext,
  ACTIVE_PARTNER_COOKIE,
} from "@/lib/auth/partner-context";
import { getPartnerMetrics } from "@/lib/dashboard/partner-metrics";
import { listPartnerMembers, getPartnerById } from "@/lib/partners/service";
import { listQrBatches, listQrCodesForBatch } from "@/lib/qr/batches";
import { PartnerSwitcher } from "@/components/partners/partner-switcher";
import { MembershipManager } from "@/components/partners/membership-manager";
import { CreateBatchForm } from "@/components/qr/create-batch-form";
import { InventoryTable } from "@/components/qr/inventory-table";
import { partnerAddMemberByEmailAction, partnerUpdateMemberRoleAction, partnerRemoveMemberAction } from "@/lib/partners/actions";
import { partnerCreateBatchAction, partnerMarkDistributedAction } from "@/lib/qr/actions";

function Stat({ label, value, testId }: { label: string; value: string | number; testId: string }) {
  return (
    <div className="rounded border border-neutral-200 bg-white p-4" data-testid={testId}>
      <p className="text-xs uppercase text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-neutral-900">{value}</p>
    </div>
  );
}

const MANAGE_ROLES = ["OWNER", "ADMIN"] as const;

/**
 * Real per-partner operational dashboard (Phase 1 — "no fake data"). Every
 * figure and row here is scoped by requirePartnerContext's verified
 * membership + RLS, so a Partner A session can never see Partner B's data no
 * matter what's in the cookie or URL.
 */
export default async function PartnerDashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/partner/login");

  const t = await getTranslations("partner");
  const memberships = await listMyPartnerMembershipsWithNames(user.id);
  if (memberships.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-medium text-neutral-900">{t("dashboard.title")}</h1>
        <p className="text-sm text-neutral-600">{t("signedInAs", { email: user.email ?? "" })}</p>
        <p className="text-sm text-neutral-500" data-testid="no-memberships">
          {t("dashboard.noMemberships")}
        </p>
      </div>
    );
  }

  const cookieStore = await cookies();
  const cookiePartnerId = cookieStore.get(ACTIVE_PARTNER_COOKIE)?.value;
  const activePartnerId =
    memberships.some((m) => m.partnerId === cookiePartnerId) ? cookiePartnerId! : memberships[0]!.partnerId;

  const data = await requirePartnerContext(async (tx, ctx) => {
    const partner = await getPartnerById(tx, ctx.partnerId);
    const metrics = await getPartnerMetrics(tx, ctx.partnerId);
    const members = await listPartnerMembers(tx, ctx.partnerId);
    const batches = await listQrBatches(tx, ctx.partnerId);
    const batchesWithCodes = await Promise.all(
      batches.map(async (batch) => ({ batch, qrCodes: await listQrCodesForBatch(tx, batch.id) })),
    );
    return { partner, metrics, members, batchesWithCodes, role: ctx.role };
  }, activePartnerId);

  const canManage = (MANAGE_ROLES as readonly string[]).includes(data.role);
  const td = await getTranslations("partner.dashboard");
  const tRole = await getTranslations("enums.partnerRole");

  return (
    <div className="flex flex-col gap-8" data-testid="partner-dashboard-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-medium text-neutral-900">{data.partner?.name ?? td("title")}</h1>
          <p className="text-xs uppercase tracking-wide text-neutral-400">{td("title")}</p>
          <p className="mt-1 text-sm text-neutral-600">{td("roleLine", { email: user.email ?? "", role: tRole(data.role as "OWNER" | "ADMIN" | "STAFF" | "VIEWER") })}</p>
        </div>
        <PartnerSwitcher memberships={memberships} activePartnerId={activePartnerId} />
      </div>

      {/* Hierarchy matches the actual business flow (Phase 4 §14): Distributed
          QR → Customer activation → Partner commission — not a flat grid of
          equally-weighted numbers. */}
      <div className="flex flex-col gap-5">
        <div>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">{td("qrCardsTitle")}</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label={td("stats.issued")} value={data.metrics.qrIssued} testId="metric-issued" />
            <Stat label={td("stats.distributed")} value={data.metrics.qrDistributed} testId="metric-distributed" />
            <Stat label={td("stats.scanned")} value={data.metrics.qrScanned} testId="metric-scanned" />
            <Stat label={td("stats.available")} value={data.metrics.qrAvailable} testId="metric-available" />
          </div>
        </div>

        <div>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">{td("salesCommissionTitle")}</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label={td("stats.successfulSales")} value={data.metrics.successfulSales} testId="metric-sales" />
            <Stat label={td("stats.commissionEarned")} value={(data.metrics.commissionEarnedMinor / 100).toFixed(2)} testId="metric-commission-earned" />
            <Stat label={td("stats.commissionPaid")} value={(data.metrics.commissionPaidMinor / 100).toFixed(2)} testId="metric-commission-paid" />
            <Stat label={td("stats.unpaidBalance")} value={(data.metrics.commissionUnpaidMinor / 100).toFixed(2)} testId="metric-commission-unpaid" />
          </div>
        </div>

        <div>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">{td("otherTitle")}</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label={td("stats.draft")} value={data.metrics.qrDraft} testId="metric-draft" />
            <Stat label={td("stats.active")} value={data.metrics.qrActive} testId="metric-active" />
            <Stat label={td("stats.batches")} value={data.metrics.batchCount} testId="metric-batch-count" />
          </div>
        </div>
      </div>

      {canManage && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-neutral-700">{td("membershipTitle")}</h2>
          <MembershipManager
            members={data.members}
            addAction={partnerAddMemberByEmailAction}
            updateRoleAction={partnerUpdateMemberRoleAction}
            removeAction={partnerRemoveMemberAction}
          />
        </section>
      )}

      {canManage && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-neutral-700">{td("createBatchTitle")}</h2>
          <CreateBatchForm createAction={partnerCreateBatchAction} />
        </section>
      )}

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-neutral-700">{td("batchesTitle")}</h2>
        {data.batchesWithCodes.map(({ batch, qrCodes }) => (
          <div key={batch.id} className="rounded border border-neutral-200 bg-white p-4" data-testid="batch-block">
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-sm font-medium">{batch.label}</h3>
              <span className="text-xs text-neutral-500">{td("codesCount", { count: qrCodes.length })}</span>
            </div>
            <InventoryTable batchId={batch.id} rows={qrCodes} markDistributedAction={partnerMarkDistributedAction} />
          </div>
        ))}
        {data.batchesWithCodes.length === 0 && <p className="text-xs text-neutral-500">{td("noBatches")}</p>}
      </section>
    </div>
  );
}
