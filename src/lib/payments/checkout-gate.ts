import "server-only";
import { env } from "@/lib/env";
import { loadMerchantInfo } from "@/lib/merchant/info";
import { describeLegalProblems, legalReadiness } from "@/lib/site/legal-readiness";
import { logServerWarning } from "@/lib/log";

/**
 * Real-money checkout is off unless CHECKOUT_ENABLED=true. The simulated TEST
 * provider is unaffected (it has its own guards: provider-factory.ts). While
 * closed, no order is opened and no provider is called, so nothing is left
 * half-started at the bank.
 */
export class CheckoutUnavailableError extends Error {
  constructor() {
    super("Checkout is not open yet");
    this.name = "CheckoutUnavailableError";
  }
}

/**
 * Real-money checkout also needs the policies FINAL and in force: every
 * policy (Terms, Privacy, Delivery & Refunds; ka and en) free of internal
 * review/decision notes, every merchant detail it names set, and
 * LEGAL_EFFECTIVE_DATE set and reached (lib/site/legal-readiness.ts) —
 * exactly when the pages themselves say "In effect from …". Consent to terms
 * marked "not yet in effect" is no consent. Fail-closed: any error = closed.
 * CHECKOUT_ENABLED alone never opens it, and neither does the owner pilot.
 *
 * Owner pilot (M1): with CHECKOUT_ENABLED=false, a QR code listed in
 * CHECKOUT_PILOT_QR_IDS is still payable (same consent, same provider, same
 * money path). Every other card stays closed. Callers that know which card the
 * payment is for pass its qr_codes.id; without it only the global switch counts.
 */
export function isCheckoutOpen(qrCodeId?: string): boolean {
  // TEST is refused outright in production (provider-factory.ts), so a
  // production deployment without a real provider is simply closed: the
  // sender sees "payments open soon" rather than a provider error.
  if (env.PAYMENTS_PROVIDER === "TEST") return env.NODE_ENV !== "production";
  if (!legalDocumentsReady()) return false;
  if (env.CHECKOUT_ENABLED) return true;
  return !!qrCodeId && env.CHECKOUT_PILOT_QR_IDS.includes(qrCodeId.toLowerCase());
}

let lastLoggedProblems = "";
function legalDocumentsReady(): boolean {
  try {
    const now = new Date();
    const r = legalReadiness(loadMerchantInfo(process.env), now);
    if (!r.ready) {
      const summary = describeLegalProblems(r.problems, now);
      // Once per distinct reason, not per request.
      if (summary !== lastLoggedProblems) {
        lastLoggedProblems = summary;
        logServerWarning("checkoutGate", "LEGAL_NOT_READY", { problems: summary.slice(0, 900) });
      }
    }
    return r.ready;
  } catch {
    return false;
  }
}

export function assertCheckoutOpen(qrCodeId?: string): void {
  if (!isCheckoutOpen(qrCodeId)) throw new CheckoutUnavailableError();
}
