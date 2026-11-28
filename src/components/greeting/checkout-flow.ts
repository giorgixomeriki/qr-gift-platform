"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { startCheckoutAction, simulateTestPaymentAction, checkPaymentReturnAction, acceptCheckoutTermsAction } from "@/lib/payments/actions";
import type { CheckoutOrderSummary } from "@/lib/payments/checkout";
import { ALL_CHECKOUT_CONSENTS, CHECKOUT_CLOSED, PAYMENT_IN_PROGRESS } from "@/lib/payments/checkout-codes";

/**
 * Checkout's state machine, shared by the legacy and the Signature checkout
 * screens so both run exactly the same payment behaviour (moved here verbatim
 * from creation-wizard.tsx's CheckoutStep — presentation lives in the screens,
 * every rule below is unchanged).
 */

/** Server action errors are developer-facing English; consumers always see localized copy. */
function logActionError(scope: string, error: string) {
  console.error(`[${scope}]`, error);
}

/** How many times to poll checkPaymentReturnAction after a real-provider redirect before falling back to showing the normal Checkout screen with a manual retry. */
const RETURN_POLL_ATTEMPTS = 5;
const RETURN_POLL_INTERVAL_MS = 2000;
/**
 * While the outcome is uncertain, re-ask the server on a slow, bounded
 * schedule (≈ 7.5 min in total), then stop and leave "Check again" to the
 * person. Never a Pay button while uncertain.
 */
const UNCERTAIN_RECHECK_DELAYS_MS = [15_000, 30_000, 60_000, 120_000, 240_000];

export function useCheckoutFlow(greetingId: string) {
  const searchParams = useSearchParams();
  const locale = useLocale();
  // A hint only, for which initial UI to show — never authority. The actual
  // status always comes from checkPaymentReturnAction/startCheckoutAction,
  // which re-derive it server-side from the order's own DB state (Phase 5 §5:
  // "a browser return URL must never be treated as proof of payment").
  const paymentHint = searchParams.get("payment");

  const [summary, setSummary] = useState<CheckoutOrderSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(paymentHint === "return");
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState(false);
  /** Real-money checkout is switched off on this deployment (CHECKOUT_ENABLED). */
  const [closed, setClosed] = useState(false);
  const [failed, setFailed] = useState(false);
  const [cancelled, setCancelled] = useState(paymentHint === "cancelled");
  const [succeeded, setSucceeded] = useState(false);
  /**
   * Back from the provider, but the outcome is not known yet (still pending
   * after polling, or the status check itself failed). Never offer to pay
   * again here — a second charge is exactly the risk — only to check again.
   */
  const [uncertain, setUncertain] = useState(false);
  const startedRef = useRef(false);

  const loadSummary = useCallback(async () => {
    const result = await startCheckoutAction(greetingId).catch(() => null);
    setLoading(false);
    if (!result?.ok) {
      if (result?.error === CHECKOUT_CLOSED) {
        setClosed(true);
        return;
      }
      if (result) logActionError("startCheckout", result.error);
      setError(true);
      return;
    }
    setSummary(result.data.summary);
    if (result.data.awaitingProvider) {
      // A bank payment for this card is still open (e.g. the sender came back
      // without the bank's return link). The bank's verdict comes first.
      setUncertain(true);
      return;
    }
    if (result.data.recovered) {
      // A prior payment already succeeded but activation hadn't completed —
      // it's been reconciled just now. Go straight to the success view.
      window.location.href = window.location.pathname;
    }
  }, [greetingId]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    if (paymentHint !== "return") {
      loadSummary();
      return;
    }
    void verifyReturn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [greetingId, paymentHint, loadSummary]);

  /** Polls the server's own verdict (never the URL) after a provider redirect. */
  async function verifyReturn() {
    setUncertain(false);
    setVerifying(true);
    for (let attempt = 0; attempt < RETURN_POLL_ATTEMPTS; attempt++) {
      const result = await checkPaymentReturnAction(greetingId).catch(() => null);
      if (result?.ok && result.data.status === "PAID") {
        window.location.href = window.location.pathname;
        return;
      }
      if (result?.ok && (result.data.status === "FAILED" || result.data.status === "CANCELED")) {
        // Only a definite failure offers paying again.
        setVerifying(false);
        setFailed(true);
        await loadSummary();
        return;
      }
      if (result && !result.ok) logActionError("checkPaymentReturn", result.error);
      if (attempt < RETURN_POLL_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, RETURN_POLL_INTERVAL_MS));
      }
    }
    // Still pending, or the check kept failing: the payment may have gone
    // through. Hold here rather than show a Pay button.
    setVerifying(false);
    setUncertain(true);
  }

  useEffect(() => {
    if (!uncertain) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const step = (i: number) => {
      if (i >= UNCERTAIN_RECHECK_DELAYS_MS.length) return;
      timer = setTimeout(async () => {
        const result = await checkPaymentReturnAction(greetingId).catch(() => null);
        if (cancelled) return;
        if (result?.ok && result.data.status === "PAID") {
          window.location.href = window.location.pathname;
          return;
        }
        if (result?.ok && (result.data.status === "FAILED" || result.data.status === "CANCELED")) {
          setUncertain(false);
          setFailed(true);
          await loadSummary();
          return;
        }
        step(i + 1);
      }, UNCERTAIN_RECHECK_DELAYS_MS[i]);
    };
    step(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [uncertain, greetingId, loadSummary]);

  /** Records the buyer's consent server-side (linked to the order); for a real provider also opens the bank payment. */
  async function acceptTerms(): Promise<{ redirectUrl?: string } | "IN_PROGRESS" | null> {
    const result = await acceptCheckoutTermsAction(greetingId, locale, ALL_CHECKOUT_CONSENTS).catch(() => null);
    if (result?.ok) return result.data;
    if (result?.error === CHECKOUT_CLOSED) setClosed(true);
    else if (result?.error === PAYMENT_IN_PROGRESS) {
      setUncertain(true);
      return "IN_PROGRESS";
    } else if (result) logActionError("acceptCheckoutTerms", result.error);
    return null;
  }

  async function pay(outcome: "success" | "failure") {
    setPaying(true);
    setError(false);
    setFailed(false);
    const accepted = outcome === "success" ? await acceptTerms() : true;
    if (accepted === "IN_PROGRESS") {
      setPaying(false);
      return;
    }
    if (!accepted) {
      setPaying(false);
      setError(true);
      return;
    }
    const result = await simulateTestPaymentAction(greetingId, outcome).catch(() => null);
    if (!result?.ok) {
      if (result) logActionError("simulateTestPayment", result.error);
      setPaying(false);
      setError(true);
      return;
    }
    if (result.data.status === "FAILED") {
      setPaying(false);
      setFailed(true);
      return;
    }
    setSucceeded(true);
    // The Greeting is now ACTIVE — reload the same public URL so the
    // dispatcher (/g/[token]) re-resolves to the Sender Success experience.
    window.location.href = window.location.pathname;
  }

  /** Consent first (server-recorded), then the bank's page — the bank payment is created only after the consent row exists. */
  async function payReal() {
    if (!summary) return;
    setPaying(true);
    setError(false);
    const accepted = await acceptTerms();
    if (accepted === "IN_PROGRESS") {
      // Already switched to "still verifying": no error, no Pay.
      setPaying(false);
      return;
    }
    if (!accepted?.redirectUrl) {
      setPaying(false);
      setError(true);
      return;
    }
    window.location.href = accepted.redirectUrl;
  }

  async function retry() {
    setFailed(false);
    setCancelled(false);
    setError(false);
    setLoading(true);
    await loadSummary();
  }


  return { summary, loading, verifying, paying, error, closed, failed, cancelled, succeeded, uncertain, verifyReturn, pay, payReal, retry };
}
