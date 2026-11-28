import { NextRequest } from "next/server";
import { editTokenCookieName } from "@/lib/security/edit-token";
import { enforceRateLimit, getClientIp, RateLimitedError } from "@/lib/rate-limit";
import { loadPurchaseConfirmation, renderConfirmationHtml } from "@/lib/payments/confirmation";
import { confirmationFileName } from "@/lib/payments/confirmation-html";
import { logServerError } from "@/lib/log";

/**
 * The sender's downloadable payment + contract confirmation (a durable copy:
 * order reference, amount, times, policies' effective date, the two consent
 * sentences). Only for the browser holding this greeting's edit-token cookie;
 * everyone else gets 404, so the response never confirms that a greeting or
 * a payment exists. Never cached; a self-contained HTML file with no scripts.
 */
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NOT_FOUND = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(request: NextRequest, { params }: { params: Promise<{ greetingId: string }> }) {
  const { greetingId } = await params;
  if (!UUID.test(greetingId)) return NOT_FOUND();
  try {
    await enforceRateLimit({ key: `confirmation:${getClientIp(request.headers)}`, limit: 20, windowSeconds: 600 });
    const data = await loadPurchaseConfirmation(greetingId, request.cookies.get(editTokenCookieName(greetingId))?.value);
    if (!data) return NOT_FOUND();
    return new Response(renderConfirmationHtml(data), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="${confirmationFileName(data.orderId)}"`,
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (err) {
    if (err instanceof RateLimitedError) return new Response("Too many requests", { status: 429, headers: { "Cache-Control": "no-store" } });
    logServerError("purchaseConfirmation", err);
    return new Response("Unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
