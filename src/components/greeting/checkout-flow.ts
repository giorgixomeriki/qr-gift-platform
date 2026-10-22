"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { startCheckoutAction, simulateTestPaymentAction, checkPaymentReturnAction } from "@/lib/payments/actions";
import type { CheckoutOrderSummary } from "@/lib/payments/checkout";
import { CHECKOUT_CLOSED } from "@/lib/payments/checkout-codes";

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

export function useCheckoutFlow(greetingId: string) {
  const searchParams = useSearchParams();
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

  async function pay(outcome: "success" | "failure") {
    setPaying(true);
    setError(false);
    setFailed(false);
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

  function payReal() {
    if (!summary?.redirectUrl) return;
    setPaying(true);
    window.location.href = summary.redirectUrl;
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
