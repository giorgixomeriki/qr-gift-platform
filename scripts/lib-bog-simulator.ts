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
  /** "503": the receipt answers 503. "drop": the connection is cut with no answer (a timeout, as the client sees it). */
  receiptFailure: null as "503" | "drop" | null,
  /** Override of what the receipt reports as transfer_amount (amount-mismatch case). */
  transferOverride: new Map<string, number>(),
  seq: 0,
};

function receiptOf(o: BogOrder) {
  return {
    order_id: o.id,
    external_order_id: o.externalOrderId,
    order_status: { key: o.status },
    purchase_units: {
      request_amount: o.requestAmount,
      transfer_amount: bog.transferOverride.get(o.id) ?? o.transferAmount,
      refund_amount: o.refundAmount,
      currency_code: o.currency,
    },
    payment_detail: { transfer_method: { key: "card" }, transaction_id: `tx-${o.id}`, payer_identifier: "548888xxxxxx1234", card_type: "mc" },
    actions: o.actions,
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
    if (!o || o.status !== "completed") return send(res, 400, { key: "refund_not_allowed" });
    const key = headers["idempotency-key"]!;
    const prior = o.actions.find((a) => a.action_id === `act-${key}`);
    if (!prior) {
      o.actions.push({ action_id: `act-${key}`, action: "refund", status: "processing", amount: (body as { amount: number }).amount });
      o.status = "refund_requested";
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
    o.status = "refunded";
    o.refundAmount = o.transferAmount ?? 0;
  } else {
    o.status = "completed";
  }
}
export function externalRefund(id: string) {
  const o = bog.orders.get(id)!;
  o.status = "refunded";
  o.refundAmount = o.transferAmount ?? 0;
  o.actions.push({ action_id: "act-portal", action: "refund", status: "completed", amount: o.refundAmount });
}
