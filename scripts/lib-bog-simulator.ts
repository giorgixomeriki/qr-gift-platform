import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { generateKeyPairSync } from "node:crypto";

/**
 * A local stand-in for BOG Payment Manager (token, orders, receipt, refund),
 * shared by the database-backed payment suites. 127.0.0.1 only; its RSA key
 * stands in for BOG's callback signing key.
 */
export const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
export const forger = generateKeyPairSync("rsa", { modulusLength: 2048 });

type BogOrder = {
  id: string;
  externalOrderId: string;
  status: string;
  requestAmount: number;
  transferAmount: number | null;
  refundAmount: number;
  currency: string;
  actions: { action_id: string; action: string; status: string; amount: number }[];
};
type Seen = { method: string; path: string; headers: Record<string, string>; body: unknown };

const RUN = crypto.randomUUID().slice(0, 8);
export const bog = {
  orders: new Map<string, BogOrder>(),
  calls: [] as Seen[],
  /** When set, the next refund calls answer with this HTTP status instead. */
  refundFailStatus: null as number | null,
  /** When set, BOG ACCEPTS the refund (records it) but every answer is lost: the client sees this HTTP status (a timeout after bank-side success). */
  refundLoseResponseStatus: null as number | null,
  /** When set, a repeat of an already-accepted Idempotency-Key answers with this status (e.g. 409 while in flight) instead of the original answer. */
  refundRepeatStatus: null as number | null,
  /** When true, the next NEW refund is accepted but its one answer is lost (504); the flag then clears itself. */
  refundLoseFirstAnswer: false,
  /** "503": the receipt answers 503. "drop": the connection is cut with no answer (a timeout, as the client sees it). */
  receiptFailure: null as "503" | "drop" | null,
  /** Override of what the receipt reports as transfer_amount (amount-mismatch case). */
  transferOverride: new Map<string, number>(),
  /** Receipt lag: an accepted-but-unsettled refund is not yet visible (order shows completed, no actions). */
  receiptHidesPendingRefund: false,
  seq: 0,
};

function receiptOf(o: BogOrder) {
  const hide = bog.receiptHidesPendingRefund && o.status === "refund_requested";
  return {
    order_id: o.id,
    external_order_id: o.externalOrderId,
    order_status: { key: hide ? "completed" : o.status },
    purchase_units: {
      request_amount: o.requestAmount,
      transfer_amount: bog.transferOverride.get(o.id) ?? o.transferAmount,
      refund_amount: o.refundAmount,
      currency_code: o.currency,
    },
    payment_detail: { transfer_method: { key: "card" }, transaction_id: `tx-${o.id}`, payer_identifier: "548888xxxxxx1234", card_type: "mc" },
    actions: hide ? [] : o.actions,
  };
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function send(res: ServerResponse, status: number, json?: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(json === undefined ? "" : JSON.stringify(json));
}

export const server = createServer(async (req, res) => {
  const raw = await readBody(req);
  const path = (req.url ?? "").split("?")[0]!;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers[k] = v;
  const body = raw.startsWith("{") ? JSON.parse(raw) : raw;
  if (path === "/token") {
    const ok = headers.authorization === `Basic ${Buffer.from("qa-client:qa-secret").toString("base64")}` && raw === "grant_type=client_credentials";
    if (!ok) return send(res, 401, { error: "invalid_client" });
    return send(res, 200, { access_token: "qa-access-token", token_type: "Bearer", expires_in: 3600 });
  }
  bog.calls.push({ method: req.method ?? "", path, headers, body });
  if (headers.authorization !== "Bearer qa-access-token") return send(res, 401, { key: "unauthorized" });

  if (req.method === "POST" && path === "/ecommerce/orders") {
    const b = body as { external_order_id: string; purchase_units: { total_amount: number; currency: string } };
    // Same Idempotency-Key → same order (as BOG documents).
    const key = headers["idempotency-key"];
    const existing = [...bog.orders.values()].find((o) => (o as BogOrder & { key?: string }).key === key);
    const order = existing ?? {
      id: `bog-${RUN}-${++bog.seq}`,
      externalOrderId: b.external_order_id,
      status: "created",
      requestAmount: b.purchase_units.total_amount,
      transferAmount: null,
      refundAmount: 0,
      currency: b.purchase_units.currency,
      actions: [],
      key,
    };
    bog.orders.set(order.id, order);
    return send(res, 200, { id: order.id, _links: { details: { href: `https://api.bog.ge/payments/v1/receipt/${order.id}` }, redirect: { href: `https://payment.bog.ge/?order_id=${order.id}` } } });
  }
  const receiptMatch = path.match(/^\/receipt\/(.+)$/);
  if (req.method === "GET" && receiptMatch) {
    if (bog.receiptFailure === "drop") return void res.destroy();
    if (bog.receiptFailure === "503") return send(res, 503, { key: "unavailable" });
    const o = bog.orders.get(decodeURIComponent(receiptMatch[1]!));
    return o ? send(res, 200, receiptOf(o)) : send(res, 404, { key: "not_found" });
  }
  const refundMatch = path.match(/^\/payment\/refund\/(.+)$/);
  if (req.method === "POST" && refundMatch) {
    if (bog.refundFailStatus) return send(res, bog.refundFailStatus, { key: "unavailable" });
    const o = bog.orders.get(decodeURIComponent(refundMatch[1]!));
    const key = headers["idempotency-key"]!;
    // BOG: a repeated Idempotency-Key returns the original answer, whatever
    // the order's state is now (docs: same status code and body).
    const prior = o?.actions.find((a) => a.action_id === `act-${key}`);
    if (o && prior) {
      if (bog.refundLoseResponseStatus) return send(res, bog.refundLoseResponseStatus, { key: "gateway_timeout" });
      if (bog.refundRepeatStatus) return send(res, bog.refundRepeatStatus, { key: "conflict" });
      return send(res, 200, { key: "request_received", message: "Refund request received", action_id: `act-${key}` });
    }
    if (!o || o.status !== "completed") return send(res, 400, { key: "refund_not_allowed" });
    if (!prior) {
      o.actions.push({ action_id: `act-${key}`, action: "refund", status: "processing", amount: (body as { amount: number }).amount });
      o.status = "refund_requested";
    }
    if (bog.refundLoseResponseStatus) return send(res, bog.refundLoseResponseStatus, { key: "gateway_timeout" });
    if (bog.refundLoseFirstAnswer) {
      bog.refundLoseFirstAnswer = false;
      return send(res, 504, { key: "gateway_timeout" });
    }
    return send(res, 200, { key: "request_received", message: "Refund request received", action_id: `act-${key}` });
  }
  return send(res, 404, { key: "no_route" });
});

/** Bank-side state changes, as BOG would make them. */
export function complete(id: string) {
  const o = bog.orders.get(id)!;
  o.status = "completed";
  o.transferAmount = o.requestAmount;
}
export function reject(id: string) {
  bog.orders.get(id)!.status = "rejected";
}
export function settleRefund(id: string, outcome: "completed" | "rejected") {
  const o = bog.orders.get(id)!;
  const a = o.actions.at(-1)!;
  a.status = outcome;
  if (outcome === "completed") {
    // As BOG documents a full refund: refund_amount = the charge,
    // transfer_amount drops to 0 (Get Payment Details example, "0.0").
    o.status = "refunded";
    o.refundAmount = o.transferAmount ?? 0;
    o.transferAmount = 0;
  } else {
    o.status = "completed";
  }
}
export function externalRefund(id: string) {
  const o = bog.orders.get(id)!;
  o.status = "refunded";
  o.refundAmount = o.transferAmount ?? 0;
  o.transferAmount = 0;
  o.actions.push({ action_id: "act-portal", action: "refund", status: "completed", amount: o.refundAmount });
}
