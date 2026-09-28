import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { Layers, Store } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { getSessionUser } from "@/lib/auth/session";
import {
  listMyPartnerMembershipsWithNames,
  requirePartnerContext,
  ACTIVE_PARTNER_COOKIE,
} from "@/lib/auth/partner-context";
import { getPartnerMetrics } from "@/lib/dashboard/partner-metrics";
import { formatMinorAmount } from "@/lib/format/money";
import { listPartnerMembers, getPartnerById } from "@/lib/partners/service";
import { listQrBatches, listQrCodesForBatch } from "@/lib/qr/batches";
import { EmptyState, PageHeader, Panel, Stat, StatGroup } from "@/components/dashboard/ui";
import { PartnerSwitcher } from "@/components/partners/partner-switcher";
import { MembershipManager } from "@/components/partners/membership-manager";
import { CreateBatchForm } from "@/components/qr/create-batch-form";
import { BatchBlock } from "@/components/qr/batch-block";
import { partnerAddMemberByEmailAction, partnerUpdateMemberRoleAction, partnerRemoveMemberAction } from "@/lib/partners/actions";
import { partnerCreateBatchAction, partnerMarkDistributedAction } from "@/lib/qr/actions";

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
      <div className="flex flex-col gap-8">
        <PageHeader title={t("dashboard.title")} description={t("signedInAs", { email: user.email ?? "" })} />
        <Panel>
          <EmptyState icon={<Store aria-hidden />} title={t("dashboard.noMembershipsTitle")} body={t("dashboard.noMemberships")} testId="no-memberships" />
        </Panel>
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
  const locale = await getLocale();
  const currency = data.partner?.currency ?? "GEL";
  const money = (minor: number) => formatMinorAmount(minor, currency, locale, { fixed: true });

  return (
    <div className="flex flex-col gap-10" data-testid="partner-dashboard-page">
      <PageHeader
        eyebrow={td("title")}
        title={data.partner?.name ?? td("title")}
        description={td("roleLine", { email: user.email ?? "", role: tRole(data.role as "OWNER" | "ADMIN" | "STAFF" | "VIEWER") })}
        actions={<PartnerSwitcher memberships={memberships} activePartnerId={activePartnerId} />}
      />

      {/* Hierarchy matches the actual business flow (Phase 4 §14): Distributed
          QR → Customer activation → Partner commission — not a flat grid of
          equally-weighted numbers. */}
      <div className="flex flex-col gap-8">
        <StatGroup title={td("salesCommissionTitle")}>
          <Stat label={td("stats.successfulSales")} value={data.metrics.successfulSales} testId="metric-sales" />
          <Stat label={td("stats.commissionEarned")} value={money(data.metrics.commissionEarnedMinor)} testId="metric-commission-earned" />
          <Stat label={td("stats.commissionPaid")} value={money(data.metrics.commissionPaidMinor)} testId="metric-commission-paid" />
          <Stat
            label={td("stats.unpaidBalance")}
            value={money(data.metrics.commissionUnpaidMinor)}
            tone="accent"
            testId="metric-commission-unpaid"
          />
        </StatGroup>

        <StatGroup title={td("qrCardsTitle")}>
          <Stat label={td("stats.issued")} value={data.metrics.qrIssued} testId="metric-issued" />
          <Stat label={td("stats.distributed")} value={data.metrics.qrDistributed} testId="metric-distributed" />
          <Stat label={td("stats.scanned")} value={data.metrics.qrScanned} testId="metric-scanned" />
          <Stat label={td("stats.available")} value={data.metrics.qrAvailable} testId="metric-available" />
        </StatGroup>

        <StatGroup title={td("otherTitle")} columns={3}>
          <Stat label={td("stats.draft")} value={data.metrics.qrDraft} testId="metric-draft" />
          <Stat label={td("stats.active")} value={data.metrics.qrActive} testId="metric-active" />
          <Stat label={td("stats.batches")} value={data.metrics.batchCount} testId="metric-batch-count" />
        </StatGroup>
      </div>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
          <h2 className="text-h2">{td("batchesTitle")}</h2>
          <span className="text-caption text-ink-3">{td("batchesHint")}</span>
        </div>

        {canManage && (
          <Panel title={td("createBatchTitle")}>
            <CreateBatchForm createAction={partnerCreateBatchAction} />
          </Panel>
        )}

        {data.batchesWithCodes.map(({ batch, qrCodes }, index) => (
          <BatchBlock
            key={batch.id}
            batch={batch}
            qrCodes={qrCodes}
            countLabel={td("codesCount", { count: qrCodes.length })}
            defaultOpen={index === 0}
            markDistributedAction={partnerMarkDistributedAction}
          />
        ))}
        {data.batchesWithCodes.length === 0 && (
          <Panel>
            <EmptyState icon={<Layers aria-hidden />} title={td("noBatches")} body={canManage ? td("noBatchesHint") : undefined} />
          </Panel>
        )}
      </section>

      {canManage && (
        <Panel title={td("membershipTitle")} description={td("membershipHint")} flush>
          <MembershipManager
            members={data.members}
            addAction={partnerAddMemberByEmailAction}
            updateRoleAction={partnerUpdateMemberRoleAction}
            removeAction={partnerRemoveMemberAction}
          />
        </Panel>
      )}
    </div>
  );
}
