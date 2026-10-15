import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { logServerError } from "@/lib/log";
import { runPaymentReconciliation } from "@/lib/payments/reconcile";

/**
 * Scheduled payment reconciliation (BOG plan §3.8): repairs only what the
 * provider confirms or what is internal-only (lib/payments/reconcile.ts),
 * and reports everything else. Called by a scheduler with
 * `Authorization: Bearer $CRON_SECRET` (Vercel Cron's convention).
 *
 * The endpoint does not exist (404) unless CRON_SECRET and
 * RECONCILE_ADMIN_USER_ID are both configured. The response carries counts
 * only — order ids and details go to the structured log.
 */
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };

function authorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: Request) {
  if (!env.CRON_SECRET || !env.RECONCILE_ADMIN_USER_ID) return new Response("Not found", { status: 404, headers });
  if (!authorized(request.headers.get("authorization"), env.CRON_SECRET)) return new Response("Unauthorized", { status: 401, headers });

  try {
    const { anomalies, actions } = await runPaymentReconciliation(env.RECONCILE_ADMIN_USER_ID, { apply: true });
    if (anomalies.length > 0) {
      console.warn(JSON.stringify({ level: "warn", scope: "paymentReconcile", anomalies, actions, timestamp: new Date().toISOString() }));
    }
    return Response.json({ anomalies: anomalies.length, repaired: actions.length }, { headers });
  } catch (err) {
    logServerError("paymentReconcile", err);
    return Response.json({ error: "reconciliation failed" }, { status: 500, headers });
  }
}
