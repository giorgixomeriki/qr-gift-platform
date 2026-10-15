/**
 * Pure checks behind `npm run ops:preflight` (scripts/ops-preflight.ts), kept
 * free of I/O so verify:ops-preflight can test every branch.
 */

export type Finding = { level: "FAIL" | "WARN" | "INFO"; message: string };

export type JournalEntry = { tag: string; when: number; hash: string };
export type LedgerRow = { hash: string; createdAt: number };

/**
 * Drizzle applies a migration only if its `when` is later than the newest
 * one recorded, so a migration merged "behind" an already-applied one is
 * skipped silently forever (the 0018/0019 trap, docs/ops/SHARED_DEV_DB_REPAIR.md).
 * Applied = a ledger row with the same `when`. A matching `when` with a
 * different hash means the file was edited after it was applied.
 */
export function migrationFindings(journal: JournalEntry[], ledger: LedgerRow[]): Finding[] {
  const byWhen = new Map(ledger.map((r) => [r.createdAt, r.hash]));
  const findings: Finding[] = [];
  const missing = journal.filter((j) => !byWhen.has(j.when));
  const newestApplied = ledger.reduce((max, r) => Math.max(max, r.createdAt), 0);
  for (const m of missing) {
    findings.push({
      level: "FAIL",
      message:
        m.when < newestApplied
          ? `${m.tag} is not applied and db:migrate will SKIP it (a later migration is already recorded) — repair by hand`
          : `${m.tag} is not applied — run db:migrate`,
    });
  }
  for (const j of journal) {
    const hash = byWhen.get(j.when);
    if (hash && hash !== j.hash) findings.push({ level: "WARN", message: `${j.tag} was edited after it was applied (ledger hash differs)` });
  }
  const known = new Set(journal.map((j) => j.when));
  for (const r of ledger) {
    if (!known.has(r.createdAt)) findings.push({ level: "WARN", message: `ledger row ${r.createdAt} matches no migration in this checkout (newer code applied?)` });
  }
  if (missing.length === 0) findings.push({ level: "INFO", message: `all ${journal.length} migrations applied` });
  return findings;
}

export type EnvSnapshot = {
  appUrl: string | undefined;
  paymentsProvider: string | undefined;
  allowTestPayments: string | undefined;
  checkoutEnabled: string | undefined;
  bogRefundsEnabled: string | undefined;
  cronSecret: string | undefined;
  reconcileAdminUserId: string | undefined;
};

const isLiveHost = (url: string | undefined) => {
  try {
    const host = new URL(url ?? "").hostname.toLowerCase();
    return host === "qrapp.ge" || host.endsWith(".qrapp.ge");
  } catch {
    return false;
  }
};

/** Combinations that are individually valid for env.ts but wrong for an environment. */
export function envFindings(e: EnvSnapshot): Finding[] {
  const findings: Finding[] = [];
  const live = isLiveHost(e.appUrl);
  const provider = e.paymentsProvider ?? "TEST";
  if (live && e.allowTestPayments === "true") findings.push({ level: "FAIL", message: "ALLOW_TEST_PAYMENTS=true on the live domain" });
  if (e.checkoutEnabled === "true") {
    findings.push({ level: "WARN", message: "CHECKOUT_ENABLED=true — real-money checkout is OPEN; confirm the owner approved it (release step M7)" });
    if (provider === "BOG" && e.bogRefundsEnabled !== "true") findings.push({ level: "WARN", message: "checkout is open but BOG_REFUNDS_ENABLED is off — every refund becomes manual" });
  } else {
    findings.push({ level: "INFO", message: `checkout closed (CHECKOUT_ENABLED unset/false), provider ${provider}` });
  }
  if (!!e.cronSecret !== !!e.reconcileAdminUserId) {
    findings.push({ level: "FAIL", message: "set both CRON_SECRET and RECONCILE_ADMIN_USER_ID, or neither — with one, scheduled reconciliation never runs" });
  } else if (!e.cronSecret) {
    findings.push({ level: provider === "BOG" ? "WARN" : "INFO", message: "scheduled reconciliation is off (CRON_SECRET / RECONCILE_ADMIN_USER_ID unset)" });
  }
  if (e.cronSecret && e.cronSecret.length < 32) findings.push({ level: "FAIL", message: "CRON_SECRET must be at least 32 characters" });
  return findings;
}
