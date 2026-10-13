import { sql } from "drizzle-orm";
import { withPublicContext } from "@/db/client";
import { logServerError } from "@/lib/log";

/**
 * Uptime-monitor target (docs/PRODUCTION_DEPLOYMENT.md §Monitoring). Proves
 * the app is serving and can reach the database as app_runtime. Public by
 * necessity, so it reveals nothing: no version, environment, host or error
 * detail — just "ok" (200) or "unavailable" (503). Never cached.
 */
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    await withPublicContext((tx) => tx.execute(sql`select 1`));
    return Response.json({ status: "ok" }, { headers });
  } catch (err) {
    logServerError("healthCheck", err);
    return Response.json({ status: "unavailable" }, { status: 503, headers });
  }
}
