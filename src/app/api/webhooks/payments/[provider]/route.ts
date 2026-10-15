import { NextRequest, NextResponse } from "next/server";
import { handleProviderWebhook, webhookEndpointExists } from "@/lib/payments/webhook";
import { enforceRateLimit, getClientIp, RateLimitedError } from "@/lib/rate-limit";

/**
 * Provider webhook/callback endpoint — the only route a payment provider's
 * server calls directly. Authenticated purely by the provider's own
 * signature, verified inside each adapter's handleWebhook; nothing here is
 * reachable by a session cookie or edit token. The handling itself lives in
 * lib/payments/webhook.ts.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!webhookEndpointExists(provider)) return new NextResponse("Unknown provider", { status: 404 });

  // Generous per-IP cap: a provider's real callback volume is tiny; this only
  // bounds a flood of unsigned requests (each costs a signature check).
  try {
    await enforceRateLimit({ key: `webhook:${getClientIp(request.headers)}`, limit: 300, windowSeconds: 60 });
  } catch (err) {
    if (err instanceof RateLimitedError) {
      return new NextResponse("Too many requests", { status: 429, headers: { "Retry-After": String(err.retryAfterSeconds) } });
    }
    throw err;
  }

  // Raw body FIRST, before any parsing — a provider's signature is computed
  // over the exact bytes sent, not over a re-serialised JSON object.
  const rawBody = await request.text();
  const result = await handleProviderWebhook(provider, rawBody, request.headers);
  return typeof result.body === "string"
    ? new NextResponse(result.body, { status: result.status })
    : NextResponse.json(result.body, { status: result.status });
}
