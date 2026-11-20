import "server-only";
import type { KeyObject } from "node:crypto";
import type {
  PaymentProvider,
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentVerificationResult,
  WebhookResult,
  RefundResult,
} from "../types";
import { ProviderNotImplementedError } from "../types";
import { BogApiError, BogTokenClient, bogRequest, type FetchLike } from "./bog/http";
import { minorToMajor } from "./bog/money";
import { mapReceipt } from "./bog/receipt";
import { callbackSchema, createOrderResponseSchema, receiptSchema, refundResponseSchema } from "./bog/schemas";
import { BOG_SIGNATURE_HEADER, parseBogPublicKey, verifyBogSignature } from "./bog/signature";
import { logServerWarning } from "@/lib/log";

/**
 * Bank of Georgia Payment Manager adapter (api.bog.ge/docs/en/payments).
 * Design: docs/integration/BOG_PAYMENT_MANAGER_PLAN.md.
 *
 * - Amounts always come from the order snapshot passed in (CreatePaymentInput
 *   is built from orders.gross_amount_minor). Nothing here knows a price.
 * - Callbacks are authenticated by SHA256withRSA over the raw body, and even
 *   then their content is not trusted: the adapter re-reads the payment from
 *   BOG's authenticated receipt endpoint and reports that.
 * - Order creation and refunds carry an Idempotency-Key, so a retried call
 *   never creates a second order or a second refund.
 * - Refunds are asynchronous at BOG: refundPayment reports PENDING, and
 *   completion arrives by callback / receipt (lib/payments/refunds.ts).
 *   They are additionally switched off unless BOG_REFUNDS_ENABLED=true.
 */

/** Hosts BOG's hosted payment page is served from. A redirect anywhere else is refused (no open redirect from a bad response). */
const REDIRECT_HOSTS = new Set(["payment.bog.ge"]);
const SUPPORTED_CURRENCIES = new Set(["GEL", "USD", "EUR", "GBP"]);
/** Order lifetime on BOG's side, in minutes (BOG allows 2–1440; default 15). Decision B2. */
const ORDER_TTL_MINUTES = 30;
/** Decision B1: payment methods offered on BOG's page. */
const PAYMENT_METHODS = ["card", "google_pay", "apple_pay"];

export type BogConfig = {
  clientId: string;
  clientSecret: string;
  apiBaseUrl: string;
  tokenUrl: string;
  /** BOG's callback-signing public key (PEM). */
  callbackPublicKey: string;
  /** Absolute https URL BOG posts callbacks to. */
  callbackUrl: string;
  refundsEnabled: boolean;
};

/**
 * A provider-supplied code made safe to log: short [A-Za-z0-9_.:-] tokens
 * only. Anything else (free text, an unexpected object, a long value that
 * could carry data) is reported as "<unrecognized>", never echoed.
 */
export function safeDiagnosticCode(value: unknown): string {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(value) ? value : "<unrecognized>";
}

/** Refunds are implemented but off unless BOG_REFUNDS_ENABLED=true. Nothing was sent to BOG. */
export class BogRefundsDisabledError extends ProviderNotImplementedError {
  constructor() {
    super("BOG", "refundPayment", "BOG_REFUNDS_ENABLED=true (refunds are not enabled for this deployment)");
  }
}

// One token cache per credential set, shared across provider instances in
// this server process (getPaymentProvider constructs a new adapter per call).
const tokenClients = new Map<string, BogTokenClient>();

export class BOGPaymentProvider implements PaymentProvider {
  readonly key = "BOG" as const;
  private readonly publicKey: KeyObject;
  private readonly tokens: BogTokenClient;
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;

  constructor(
    private readonly config: BogConfig,
    deps: { fetch?: FetchLike; tokens?: BogTokenClient } = {},
  ) {
    this.fetchImpl = deps.fetch ?? ((input, init) => fetch(input, init));
    this.publicKey = parseBogPublicKey(config.callbackPublicKey);
    this.baseUrl = config.apiBaseUrl.replace(/\/+$/, "");
    const cacheKey = `${config.tokenUrl}|${config.clientId}`;
    let tokens = deps.tokens ?? (deps.fetch ? undefined : tokenClients.get(cacheKey));
    if (!tokens) {
      tokens = new BogTokenClient({ tokenUrl: config.tokenUrl, clientId: config.clientId, clientSecret: config.clientSecret }, this.fetchImpl);
      if (!deps.fetch) tokenClients.set(cacheKey, tokens);
    }
    this.tokens = tokens;
  }

  private get http() {
    return { fetchImpl: this.fetchImpl, tokens: this.tokens };
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
      throw new Error(`BOG createPayment: amount must be a positive integer of minor units, got ${input.amountMinor}`);
    }
    if (!SUPPORTED_CURRENCIES.has(input.currency)) throw new Error(`BOG createPayment: unsupported currency ${input.currency}`);
    const amount = minorToMajor(input.amountMinor);

    // One key per attempt; bogRequest's single retry reuses it, so a timeout
    // after BOG created the order returns that same order, not a second one.
    const idempotencyKey = crypto.randomUUID();
    const response = await bogRequest(
      this.http,
      {
        method: "POST",
        url: `${this.baseUrl}/ecommerce/orders`,
        headers: { "Idempotency-Key": idempotencyKey, "Accept-Language": input.locale ?? "ka" },
        idempotent: true,
        body: {
          callback_url: this.config.callbackUrl,
          external_order_id: input.orderId,
          capture: "automatic",
          ttl: ORDER_TTL_MINUTES,
          payment_method: PAYMENT_METHODS,
          redirect_urls: { success: input.returnUrls.success, fail: input.returnUrls.cancel },
          purchase_units: {
            currency: input.currency,
            total_amount: amount,
            basket: [
              {
                product_id: input.productId ?? "greeting",
                description: "QR Starr greeting",
                quantity: 1,
                unit_price: amount,
              },
            ],
          },
        },
      },
      createOrderResponseSchema,
    );

    const redirect = new URL(response._links.redirect.href);
    if (redirect.protocol !== "https:" || !REDIRECT_HOSTS.has(redirect.hostname)) {
      throw new Error(`BOG createPayment: refusing redirect to unexpected host ${redirect.hostname}`);
    }
    return { providerPaymentId: response.id, redirectUrl: redirect.toString(), metadata: { providerReference: response.id } };
  }

  async verifyPayment(providerPaymentId: string): Promise<PaymentVerificationResult> {
    return mapReceipt(await this.fetchReceipt(providerPaymentId));
  }

  private async fetchReceipt(providerPaymentId: string) {
    const receipt = await bogRequest(
      this.http,
      { method: "GET", url: `${this.baseUrl}/receipt/${encodeURIComponent(providerPaymentId)}`, idempotent: true },
      receiptSchema,
    );
    if (receipt.order_id !== providerPaymentId) {
      throw new Error("BOG receipt is for a different order than requested");
    }
    return receipt;
  }

  /**
   * 1. Callback-Signature must verify over the raw body (no parsing before).
   * 2. Only body.order_id is taken from the callback.
   * 3. The payment's state, amount and our order id come from a fresh,
   *    authenticated receipt. A replayed or reordered callback can therefore
   *    only ever report the current truth, and settlement is idempotent.
   */
  async handleWebhook(rawBody: string, headers: Headers): Promise<WebhookResult> {
    if (!verifyBogSignature(rawBody, headers.get(BOG_SIGNATURE_HEADER), this.publicKey)) {
      throw new Error("BOG callback signature invalid or missing");
    }
    const parsed = callbackSchema.safeParse(JSON.parse(rawBody));
    if (!parsed.success) throw new Error("BOG callback body has an unexpected shape");
    if (parsed.data.event !== "order_payment") {
      // FA-03: a signed callback with another event name (BOG has not
      // confirmed what a refund callback is called) is still BOG telling us
      // "look at this order". Nothing is taken from it except order_id; the
      // state comes from the fresh receipt below, exactly as for
      // order_payment, so it settles payments and refunds alike instead of
      // being refused with 400. Logged as a code only, to learn the name.
      logServerWarning("bogWebhook", "OTHER_EVENT", {
        event: safeDiagnosticCode(parsed.data.event),
        bogOrderId: safeDiagnosticCode(parsed.data.body.order_id),
      });
    }

    const receipt = await this.fetchReceipt(parsed.data.body.order_id);
    if (!receipt.external_order_id) throw new Error("BOG receipt has no external_order_id");
    return { ...mapReceipt(receipt), orderId: receipt.external_order_id };
  }

  async refundPayment(providerPaymentId: string, amountMinor?: number, idempotencyKey?: string): Promise<RefundResult> {
    if (!this.config.refundsEnabled) throw new BogRefundsDisabledError();
    if (!idempotencyKey) throw new Error("BOG refundPayment requires an idempotency key");
    if (amountMinor === undefined) throw new Error("BOG refundPayment requires an explicit amount");

    try {
      const response = await bogRequest(
        this.http,
        {
          method: "POST",
          url: `${this.baseUrl}/payment/refund/${encodeURIComponent(providerPaymentId)}`,
          headers: { "Idempotency-Key": idempotencyKey },
          idempotent: true,
          body: { amount: minorToMajor(amountMinor) },
        },
        refundResponseSchema,
      );
      if (response.key !== "request_received") {
        // Diagnostic: an answer BOG documents nowhere. Treated as not
        // accepted (FAILED → REFUND_REJECTED for a person), logged as codes only.
        logServerWarning("bogRefund", "UNEXPECTED_REFUND_RESPONSE", {
          bogOrderId: safeDiagnosticCode(providerPaymentId),
          key: safeDiagnosticCode(response.key),
          actionIdPresent: !!response.action_id,
        });
        return { providerPaymentId, refundedAmountMinor: 0, status: "FAILED" };
      }
      return { providerPaymentId, refundedAmountMinor: 0, status: "PENDING", providerActionId: response.action_id ?? undefined };
    } catch (err) {
      // A definite refusal (4xx) is FAILED. A network error or 5xx is
      // rethrown: BOG may have received it, so the caller keeps the refund
      // REQUESTED and a retry reuses the same Idempotency-Key.
      if (err instanceof BogApiError && err.status >= 400 && err.status < 500) {
        logServerWarning("bogRefund", "REFUND_REFUSED", {
          bogOrderId: safeDiagnosticCode(providerPaymentId),
          httpStatus: err.status,
          key: safeDiagnosticCode(err.bogKey),
        });
        return { providerPaymentId, refundedAmountMinor: 0, status: "FAILED" };
      }
      if (err instanceof BogApiError && err.status >= 200 && err.status < 300) {
        // 2xx with a body we cannot read: BOG may have accepted it, so the
        // caller keeps it REQUESTED (re-sent with the same key later).
        logServerWarning("bogRefund", "UNREADABLE_REFUND_RESPONSE", {
          bogOrderId: safeDiagnosticCode(providerPaymentId),
          httpStatus: err.status,
        });
      }
      throw err;
    }
  }
}
