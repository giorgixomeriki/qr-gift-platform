import { z } from "zod";

/**
 * Shapes of BOG Payment Manager responses (api.bog.ge/docs/en/payments/...).
 * Only fields the adapter reads are declared; unknown fields pass through
 * untouched and are never persisted (sanitizeProviderMetadata allowlists).
 * Every response is parsed before use — an unexpected shape fails closed.
 */

/** BOG documents amounts as numbers; a decimal string is accepted too. */
const amount = z.union([z.number(), z.string().regex(/^\d+(\.\d{1,2})?$/)]);

export const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
});

export const createOrderResponseSchema = z.object({
  id: z.string().min(1),
  _links: z.object({
    redirect: z.object({ href: z.string().url() }),
    details: z.object({ href: z.string().url() }).optional(),
  }),
});

/** order_status.key values (Get Payment Details). */
export const BOG_ORDER_STATUSES = [
  "created",
  "processing",
  "completed",
  "rejected",
  "refund_requested",
  "refunded",
  "refunded_partially",
  "auth_requested",
  "blocked",
  "partial_completed",
] as const;

export const receiptSchema = z.object({
  order_id: z.string().min(1),
  external_order_id: z.string().nullish(),
  order_status: z.object({ key: z.string().min(1), value: z.string().nullish() }),
  purchase_units: z.object({
    request_amount: amount.nullish(),
    transfer_amount: amount.nullish(),
    refund_amount: amount.nullish(),
    currency_code: z.string().length(3),
  }),
  payment_detail: z
    .object({
      transfer_method: z.object({ key: z.string().nullish() }).nullish(),
      transaction_id: z.string().nullish(),
      payer_identifier: z.string().nullish(),
      card_type: z.string().nullish(),
      code: z.union([z.string(), z.number()]).nullish(),
      code_description: z.string().nullish(),
    })
    .nullish(),
  actions: z
    .array(
      z.object({
        action_id: z.string().nullish(),
        action: z.string(),
        status: z.string(),
        code: z.union([z.string(), z.number()]).nullish(),
        amount: amount.nullish(),
      }),
    )
    .nullish(),
  reject_reason: z.string().nullish(),
});
export type BogReceipt = z.infer<typeof receiptSchema>;

export const refundResponseSchema = z.object({
  key: z.string().min(1),
  message: z.string().nullish(),
  action_id: z.string().nullish(),
});

/** Callback envelope. Only order_id is read from the body — state comes from a fresh receipt. */
export const callbackSchema = z.object({
  event: z.string(),
  zoned_request_time: z.string().nullish(),
  body: z.object({ order_id: z.string().min(1) }),
});
