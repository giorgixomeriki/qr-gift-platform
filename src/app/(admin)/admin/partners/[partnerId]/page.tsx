import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Layers } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { requireAdmin, requireAdminPage } from "@/lib/auth/admin";
import { getPartnerById, listPartnerMembers } from "@/lib/partners/service";
import { listQrBatches, listQrCodesForBatch } from "@/lib/qr/batches";
import { toInventoryRow } from "@/lib/qr/credential-access";
import { getPartnerUnpaidBalance, listPartnerPayoutsWithItems } from "@/lib/payments/payouts";
import { getPartnerPricing, listPricingAuditLog } from "@/lib/payments/pricing-admin";
import { getBatchPerformance, listPartnerSalesTrace } from "@/lib/dashboard/attribution";
import { getPartnerInventorySummary } from "@/lib/dashboard/inventory";
import { getLoginStatus } from "@/lib/partners/login-access";
import { authDirectory } from "@/lib/auth/auth-directory";
import { emailDeliveryConfigured } from "@/lib/notify/email";
import { env } from "@/lib/env";
import { PartnerLoginPanel } from "@/components/admin/partner-login-panel";
import { getPartnerCardStock, listPartnerLocations } from "@/lib/partner-locations/admin";
import { formatMinorAmount } from "@/lib/format/money";
import { NotAdmin } from "@/components/admin/not-admin";
import { PartnerStatusToggle } from "@/components/admin/partner-status-toggle";
import { PartnerPricingManager } from "@/components/admin/partner-pricing-manager";
import { PayoutManager } from "@/components/admin/payout-manager";
import { PartnerLocationsManager, type AdminLocationRow } from "@/components/admin/partner-locations-manager";
import { SalesTrace } from "@/components/admin/sales-trace";
import { EmptyState, PageHeader, Panel, Stat, StatGroup } from "@/components/dashboard/ui";
import { Notice } from "@/components/ui/notice";
import { MembershipManager } from "@/components/partners/membership-manager";
import { BatchBlock } from "@/components/qr/batch-block";
import { CreateBatchForm } from "@/components/qr/create-batch-form";
import {
  adminAddPartnerMemberByEmailAction,
  adminUpdatePartnerMemberRoleAction,
  adminRemovePartnerMemberAction,
} from "@/lib/partners/actions";
import { adminCreateBatchAction, adminMarkDistributedAction } from "@/lib/qr/actions";
import { adminRecordPayoutAction, adminGetPayoutStatementAction } from "@/lib/payments/payout-actions";
import { adminRefundPaidOrderAction, adminRecordChargebackAction, adminDisputeEvidenceAction } from "@/lib/payments/admin-actions";

export default async function AdminPartnerDetailPage({ params }: { params: Promise<{ partnerId: string }> }) {
  const { partnerId } = await params;

  const { user, isAdmin } = await requireAdminPage();

  const t = await getTranslations("admin");
  if (!isAdmin) return <NotAdmin message={t("notAdmin", { email: user.email ?? "" })} />;

  const data = await requireAdmin(async (tx) => {
    const partner = await getPartnerById(tx, partnerId);
    if (!partner) return null;
    const members = await listPartnerMembers(tx, partnerId);
    const batches = await listQrBatches(tx, partnerId);
    const batchesWithCodes = await Promise.all(
      batches.map(async (batch) => ({
        batch: { id: batch.id, label: batch.label },
        qrCodes: (await listQrCodesForBatch(tx, batch.id)).map((qr) => toInventoryRow(qr, "ADMIN")),
      })),
    );
    const unpaidBalanceMinor = await getPartnerUnpaidBalance(tx, partnerId, partner.currency);
    const payouts = await listPartnerPayoutsWithItems(tx, partnerId);
    const performance = await getBatchPerformance(tx, partnerId);
    const sales = await listPartnerSalesTrace(tx, partnerId);
    const pricing = await getPartnerPricing(tx, partnerId);
    const pricingHistory = await listPricingAuditLog(tx, partnerId);
    const login = await getLoginStatus(tx, partnerId, authDirectory());
    // Same function and definitions as the partner's own dashboard.
    const inventory = await getPartnerInventorySummary(tx, partnerId);
    const locations = await listPartnerLocations(tx, partnerId);
    const cardStock = await getPartnerCardStock(tx, partnerId);
    return { login, partner, members, batchesWithCodes, unpaidBalanceMinor, payouts, performance, sales, pricing, pricingHistory, inventory, locations, cardStock };
  });

  if (!data) notFound();
  const { login, partner, members, batchesWithCodes, unpaidBalanceMinor, payouts, performance, sales, pricing, pricingHistory, locations, cardStock } = data;
  const locationRows: AdminLocationRow[] = locations.map((l) => ({
    id: l.id,
    branchName: l.branchName,
    category: l.category as AdminLocationRow["category"],
    addressKa: l.addressKa,
    addressEn: l.addressEn,
    cityKa: l.cityKa,
    cityEn: l.cityEn,
    districtKa: l.districtKa,
    districtEn: l.districtEn,
    latitude: l.latitude,
    longitude: l.longitude,
    phone: l.phone,
    hoursKa: l.hoursKa,
    hoursEn: l.hoursEn,
    stocksCards: l.stocksCards,
    isPublic: l.isPublic,
    isMock: l.isMock,
    verified: l.coordinatesVerifiedAt !== null,
    availability: l.availability,
    updatedAt: l.updatedAt.toISOString(),
  }));
  const tLoc = await getTranslations("admin.locations");
  const td = await getTranslations("admin.partnerDetail");
  const tStats = await getTranslations("partner.dashboard");
  const tPerf = await getTranslations("batchPerformance");
  const locale = await getLocale();
  const performanceLabel = (batchId: string) => {
    const p = performance.find((row) => row.batchId === batchId);
    if (!p) return undefined;
    return tPerf("summary", {
      distributed: p.distributed,
      scanned: p.scanned,
      paid: p.paidActivations,
      conversion: p.conversionPct === null ? "—" : `${p.conversionPct}%`,
      commission: formatMinorAmount(p.netCommissionMinor, partner.currency, locale, { fixed: true }),
    });
  };
  const tNav = await getTranslations("nav");
  const tAccess = await getTranslations("partnerAccess.admin");
  const tInventory = await getTranslations("handover.inventory");

  const markDistributed = adminMarkDistributedAction.bind(null, partnerId);
  const createBatch = adminCreateBatchAction.bind(null, partnerId);
  const addMember = adminAddPartnerMemberByEmailAction.bind(null, partnerId);
  const updateMemberRole = adminUpdatePartnerMemberRoleAction.bind(null, partnerId);
  const removeMember = adminRemovePartnerMemberAction.bind(null, partnerId);

  return (
    <div className="flex flex-col gap-10" data-testid="admin-partner-detail-page">
      <div className="flex flex-col gap-4">
        <Link href="/admin/partners" className="-ml-1 inline-flex w-fit items-center gap-1 text-label text-ink-2 hover:text-ink">
          <ChevronLeft className="size-4" aria-hidden />
          {tNav("partners")}
        </Link>
        <PageHeader
          title={partner.name}
          description={<span className="font-mono text-caption">{partner.slug}</span>}
          actions={partner.isCentralStock ? undefined : <PartnerStatusToggle partnerId={partner.id} status={partner.status} />}
        />
      </div>

      {partner.isCentralStock ? (
        <Notice tone="info" title={tInventory("central.title")}>
          {tInventory("central.partnerPageNote")}
        </Notice>
      ) : (
        <>
      <Panel title={tAccess("title")} description={tAccess("hint")}>
        <PartnerLoginPanel
          partnerId={partner.id}
          contactEmail={login.contactEmail}
          contactPhone={login.contactPhone}
          logins={login.logins}
          pending={login.pending ? { ...login.pending, expiresAt: login.pending.expiresAt.toISOString() } : null}
          emailConfigured={emailDeliveryConfigured()}
          phoneEnabled={env.PARTNER_PHONE_AUTH_ENABLED}
        />
      </Panel>

      <Panel title={td("pricingTitle")} description={td("pricingHint")}>
        <PartnerPricingManager partnerId={partner.id} pricing={pricing} history={pricingHistory} />
      </Panel>

      <Panel title={td("payoutsTitle")} flush>
        <PayoutManager
          partnerId={partner.id}
          currency={partner.currency}
          unpaidBalanceMinor={unpaidBalanceMinor}
          payouts={payouts}
          recordAction={adminRecordPayoutAction}
          statementAction={adminGetPayoutStatementAction}
        />
      </Panel>

      <Panel title={td("salesTitle")} description={td("salesHint")} flush>
        <SalesTrace rows={sales} refundAction={adminRefundPaidOrderAction} chargebackAction={adminRecordChargebackAction} evidenceAction={adminDisputeEvidenceAction} />
      </Panel>
        </>
      )}

      <StatGroup title={tStats("qrCardsTitle")}>
        <Stat label={tStats("stats.issued")} value={data.inventory.issued} testId="admin-metric-issued" />
        <Stat label={tStats("stats.available")} value={data.inventory.available} testId="admin-metric-available" />
        <Stat label={tStats("stats.draft")} value={data.inventory.draft} testId="admin-metric-draft" />
        <Stat label={tStats("stats.active")} value={data.inventory.active} testId="admin-metric-active" />
        <Stat label={tStats("stats.blocked")} value={data.inventory.blocked} testId="admin-metric-blocked" />
        <Stat label={tStats("stats.distributed")} value={data.inventory.distributed} testId="admin-metric-distributed" />
        <Stat label={tStats("stats.scanned")} value={data.inventory.scannedCards} testId="admin-metric-scanned" />
        <Stat label={tStats("stats.batches")} value={data.inventory.batchCount} testId="admin-metric-batch-count" />
      </StatGroup>

      <Panel title={tLoc("title")} description={tLoc("hint")}>
        <PartnerLocationsManager partnerId={partner.id} locations={locationRows} distributedUnsold={cardStock.distributedUnsold} />
      </Panel>

      <section className="flex flex-col gap-4">
        <h2 className="text-h2">{td("batchesTitle")}</h2>
        <Panel title={td("createBatchTitle")}>
          <CreateBatchForm createAction={createBatch} />
        </Panel>
        {batchesWithCodes.map(({ batch, qrCodes }, index) => (
          <BatchBlock
            key={batch.id}
            batch={batch}
            qrCodes={qrCodes}
            countLabel={td("codesCount", { count: qrCodes.length })}
            performanceLabel={performanceLabel(batch.id)}
            defaultOpen={index === 0}
            markDistributedAction={markDistributed}
          />
        ))}
        {batchesWithCodes.length === 0 && (
          <Panel>
            <EmptyState icon={<Layers aria-hidden />} title={td("noBatches")} />
          </Panel>
        )}
      </section>

      {(env.PARTNER_TEAM_MEMBERS_ENABLED || members.length > 1) && (
      <Panel title={td("membershipTitle")} flush>
        <MembershipManager members={members} addAction={addMember} updateRoleAction={updateMemberRole} removeAction={removeMember} />
      </Panel>
      )}
    </div>
  );
}
