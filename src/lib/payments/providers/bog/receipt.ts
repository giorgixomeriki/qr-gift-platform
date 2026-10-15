import type { PaymentVerificationResult } from "../../types";
import { majorToMinor } from "./money";
import type { BogReceipt } from "./schemas";

/**
 * Maps a BOG receipt (Get Payment Details) onto the provider-neutral
 * verification result. Pre-authorization states are never treated as paid
 * (capture is always automatic here), and an unknown status stays PENDING,
 * so reconciliation keeps asking and the anomaly report lists it.
 */
export function mapReceipt(receipt: BogReceipt): PaymentVerificationResult {
  const key = receipt.order_status.key;
  const units = receipt.purchase_units;
  const currency = units.currency_code.toUpperCase();

  let status: PaymentVerificationResult["status"];
  let refundStatus: NonNullable<PaymentVerificationResult["refund"]>["status"] = "NONE";
  switch (key) {
    case "completed":
      status = "SUCCEEDED";
      break;
    case "refund_requested":
      status = "SUCCEEDED";
      refundStatus = "REQUESTED";
      break;
    case "refunded":
      status = "SUCCEEDED";
      refundStatus = "COMPLETED";
      break;
    case "refunded_partially":
      status = "SUCCEEDED";
      refundStatus = "PARTIAL";
      break;
    case "rejected":
      status = "FAILED";
      break;
    default:
      // created, processing, and the pre-authorization states (auth_requested,
      // blocked, partial_completed) that this integration never requests.
      status = "PENDING";
  }

  // A charge's amount is what BOG actually processed. A "completed" receipt
  // without transfer_amount is malformed, so it fails rather than guessing.
  const charged = status === "SUCCEEDED" ? units.transfer_amount : (units.transfer_amount ?? units.request_amount);
  if (charged === null || charged === undefined) {
    if (status === "SUCCEEDED") throw new Error("BOG receipt for a completed payment has no transfer_amount");
  }
  const amountMinor = charged === null || charged === undefined ? 0 : majorToMinor(charged);

  const rejectedActionIds = (receipt.actions ?? [])
    .filter((a) => (a.action === "refund" || a.action === "partial_refund") && a.status === "rejected")
    .map((a) => a.action_id ?? "unknown");

  const detail = receipt.payment_detail;
  const last4 = detail?.payer_identifier?.match(/(\d{4})$/)?.[1];
  const metadata: Record<string, unknown> = {
    providerReference: detail?.transaction_id ?? receipt.order_id,
    ...(detail?.card_type ? { cardBrand: detail.card_type } : {}),
    ...(last4 && detail?.transfer_method?.key === "card" ? { cardLast4: last4 } : {}),
    ...(detail?.transfer_method?.key ? { paymentMethodType: detail.transfer_method.key } : {}),
    ...(status === "FAILED" ? { failureReason: receipt.reject_reason ?? detail?.code_description ?? "rejected" } : {}),
  };

  return {
    providerPaymentId: receipt.order_id,
    status,
    amountMinor,
    currency,
    metadata,
    refund: {
      status: refundStatus,
      refundedAmountMinor: units.refund_amount === null || units.refund_amount === undefined ? 0 : majorToMinor(units.refund_amount),
      rejectedActionIds,
    },
  };
}
