import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getPaymentProvider } from "@/lib/payments/provider-factory";
import { confirmPaymentSuccess, activatePaidOrder, PaymentConfirmationError } from "@/lib/payments/service";
import { paymentProviderKeySchema, ProviderNotImplementedError } from "@/lib/payments/types";
import { recordAnalyticsEvent } from "@/lib/analytics";

/**
 * Provider webhook/callback endpoint (Phase 5 §6) — the only route a real
 * payment provider's server calls directly. Deliberately generic per-provider
 * (`[provider]` segment) rather than one route per provider: the actual
 * signature/authentication verification lives inside each provider adapter's
 * own handleWebhook (see types.ts's PaymentProvider interface doc comment
 * and bog-provider.ts) — this route's job is transport plumbing and
 * cross-validation, never trusting the payload's own claims on their own.
 *
 * No client authority anywhere in this path: the browser never calls this
 * route, and nothing here is reachable by a session cookie or edit token —
 * it's authenticated purely by the provider's own signature (whatever that
 * turns out to be), verified inside handleWebhook.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerParam } = await params;
  const parsedProvider = paymentProviderKeySchema.safeParse(providerParam);

  // Only the currently-configured provider is ever accepted — a webhook
  // addressed to a provider this deployment isn't using is rejected outright,
  // never routed to a provider adapter that isn't actually active.
  if (!parsedProvider.success || parsedProvider.data !== env.PAYMENTS_PROVIDER) {
    return new NextResponse("Unknown provider", { status: 404 });
  }

  // Raw body FIRST, before any parsing — a real provider's signature is
  // computed over the exact bytes sent, not over a re-serialized JSON object,
  // which could differ (key order, whitespace, number formatting).
  const rawBody = await request.text();

  let webhookResult;
  try {
    const provider = getPaymentProvider();
    webhookResult = await provider.handleWebhook(rawBody, request.headers);
  } catch (err) {
    if (err instanceof ProviderNotImplementedError) {
      // Safe logging only — never the raw body (which could carry pseudo
      // card-holder data even if truncated) and never headers verbatim.
      console.error(`[webhook] ${parsedProvider.data} handleWebhook not implemented`);
      return new NextResponse("Provider not implemented", { status: 501 });
    }
    // Any other failure inside handleWebhook (signature mismatch, malformed
    // payload) is treated as "not a genuine webhook" — 400, no detail leaked.
    console.error(`[webhook] ${parsedProvider.data} verification failed:`, err instanceof Error ? err.message : err);
    return new NextResponse("Invalid webhook", { status: 400 });
  }

  try {
    const { order } = await confirmPaymentSuccess({
      provider: parsedProvider.data,
      providerPaymentId: webhookResult.providerPaymentId,
      orderId: webhookResult.orderId,
      amountMinor: webhookResult.amountMinor,
      currency: webhookResult.currency,
      metadata: webhookResult.metadata,
    });

    if (webhookResult.status === "SUCCEEDED") {
      const { activated } = await activatePaidOrder(webhookResult.orderId);
      if (activated) {
        // order comes straight from confirmPaymentSuccess's own return value,
        // not a fresh SELECT — orders has no public-read RLS policy, so an
        // unauthenticated re-query here would silently return nothing.
        await recordAnalyticsEvent(
          { eventType: "QR_ACTIVATED", qrCodeId: order.qrCodeId, greetingId: order.greetingId },
          { partnerId: order.partnerId },
        );
      }
    }

    // 200 regardless of "already processed" — a provider's retry of a
    // webhook it already delivered must be treated as a normal success, not
    // an error, or the provider will keep retrying forever (idempotent
    // duplicate delivery safety, Phase 5 §6/§10).
    return NextResponse.json({ received: true });
  } catch (err) {
    if (err instanceof PaymentConfirmationError) {
      // Order not found / wrong status / amount-currency mismatch / payment-
      // order mismatch — a real, specific rejection, not a transient error.
      // 400 tells a well-behaved provider "don't retry this one," rather than
      // 5xx's "try again," since retrying won't change the outcome.
      console.error(`[webhook] ${parsedProvider.data} rejected:`, err.message);
      return new NextResponse("Rejected", { status: 400 });
    }
    console.error(`[webhook] ${parsedProvider.data} internal error:`, err instanceof Error ? err.message : err);
    return new NextResponse("Internal error", { status: 500 });
  }
}
