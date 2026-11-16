/**
 * Non-financial check of a Bank of Georgia Payment Manager credential set.
 *
 *   node --env-file=<0600 file with BOG_*> node_modules/.bin/tsx scripts/ops/bog-credentials-check.ts
 *
 * 1. Hosts: BOG_OAUTH_TOKEN_URL / BOG_API_BASE_URL must be https on bog.ge.
 * 2. Callback key: BOG_WEBHOOK_SIGNING_KEY must be the RSA public key BOG
 *    publishes (api.bog.ge/docs/en/payments/standard-process/callback),
 *    compared by SHA-256 of its DER encoding.
 * 3. Authentication: one client_credentials token request (no order, no money).
 * 4. Authorization: GET /receipt/<random UUID> with that token, contrasted with
 *    the same call using an invalid token. BOG answers an unknown order with
 *    400 (observed 2026-11-17) and a bad token with 401, so "valid ≠ 401/403
 *    and invalid = 401" proves the credentials are authorized.
 *
 * Creates no order, makes no payment or refund, and prints no secret, token
 * or identifier: only PASS/FAIL lines and HTTP status codes.
 */
import { createHash, createPublicKey, randomUUID } from "node:crypto";
import { BogTokenClient } from "../../src/lib/payments/providers/bog/http";

/** SHA-256 (DER) of BOG's published callback-signing key, read from the docs on 2026-11-16. */
const BOG_DOCUMENTED_KEY_SHA256 = "00ce06ee8db57a339d3ff889bf0d7648f542c66b45fa9954d75d3f5e500fa77d";
const DEFAULT_TOKEN_URL = "https://oauth2.bog.ge/auth/realms/bog/protocol/openid-connect/token";
const DEFAULT_API_BASE = "https://api.bog.ge/payments/v1";

let failed = 0;
function report(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function bogHttps(value: string): boolean {
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase();
    return u.protocol === "https:" && (host === "bog.ge" || host.endsWith(".bog.ge"));
  } catch {
    return false;
  }
}

async function main() {
  const clientId = process.env.BOG_CLIENT_ID?.trim();
  const clientSecret = process.env.BOG_CLIENT_SECRET?.trim();
  const tokenUrl = process.env.BOG_OAUTH_TOKEN_URL?.trim() || DEFAULT_TOKEN_URL;
  const apiBase = (process.env.BOG_API_BASE_URL?.trim() || DEFAULT_API_BASE).replace(/\/+$/, "");
  const key = process.env.BOG_WEBHOOK_SIGNING_KEY?.trim();

  report("1a. BOG_CLIENT_ID and BOG_CLIENT_SECRET are set", Boolean(clientId && clientSecret));
  report("1b. Token URL is https on bog.ge", bogHttps(tokenUrl));
  report("1c. API base URL is https on bog.ge", bogHttps(apiBase));

  if (key) {
    try {
      const der = createPublicKey({ key: key.replace(/\\n/g, "\n"), format: "pem" }).export({ type: "spki", format: "der" });
      report("2. Callback key is BOG's documented public key", createHash("sha256").update(der).digest("hex") === BOG_DOCUMENTED_KEY_SHA256);
    } catch {
      report("2. Callback key is BOG's documented public key", false, "not a PEM public key");
    }
  } else {
    report("2. Callback key is BOG's documented public key", false, "BOG_WEBHOOK_SIGNING_KEY not set");
  }

  if (!clientId || !clientSecret || !bogHttps(tokenUrl) || !bogHttps(apiBase)) {
    console.log("Skipping network checks: configuration incomplete.");
    process.exit(1);
  }

  const tokens = new BogTokenClient({ tokenUrl, clientId, clientSecret }, (input, init) => fetch(input, init));
  let token: string;
  try {
    token = await tokens.getToken();
    report("3. OAuth client_credentials token issued", token.length > 0);
  } catch (err) {
    report("3. OAuth client_credentials token issued", false, err instanceof Error ? err.message : "error");
    process.exit(1);
  }

  const probe = async (bearer: string) =>
    (
      await fetch(`${apiBase}/receipt/${randomUUID()}`, {
        headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      }).catch(() => null)
    )?.status ?? 0;
  const valid = await probe(token);
  const invalid = await probe("invalid-token");
  report(
    "4. Payments API authorizes the token (unknown order → 400/404; invalid token → 401)",
    (valid === 400 || valid === 404) && invalid === 401,
    `valid token HTTP ${valid}, invalid token HTTP ${invalid}`,
  );

  console.log(failed === 0 ? "\nAll checks passed. No order was created." : `\n${failed} check(s) failed. No order was created.`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
