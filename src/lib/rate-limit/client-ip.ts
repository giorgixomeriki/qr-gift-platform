import "server-only";
import { isIP } from "node:net";

/**
 * Where the trusted proxy in front of the app puts the caller's IP. Set per
 * deployment (lib/env-guards.ts clientIpConfigProblems requires one of them
 * on any hosted platform other than Vercel):
 *
 * - `header`: a single-value header the proxy sets and the client cannot
 *   (e.g. `true-client-ip`).
 * - `proxyCount`: how many trusted proxies APPEND to X-Forwarded-For. The
 *   client is then the entry that many places from the right; everything to
 *   its left came from the client and is ignored, so a spoofed header buys
 *   nothing. Set too high, the chosen entry is one of our own proxies, so the
 *   rate limit gets coarser, never bypassable.
 * - neither (Vercel, local dev): the first X-Forwarded-For entry. Safe only
 *   where the proxy OVERWRITES the header, which Vercel does.
 *
 * With both set, the header wins and proxyCount is the fallback. Anything
 * missing or not an IP lands in one shared "unattributed" bucket, which keeps
 * the limit meaningful (a fresh key per request would never collide).
 * Verification on a new host: docs/RENDER_DEPLOYMENT.md (/api/ops/client-ip).
 */
export type ClientIpConfig = { header?: string; proxyCount?: number };

const UNATTRIBUTED = "unattributed";

export function clientIpConfigFromEnv(env: Record<string, string | undefined> = process.env): ClientIpConfig {
  const proxyCount = Number(env.TRUSTED_PROXY_COUNT);
  return {
    header: env.CLIENT_IP_HEADER?.toLowerCase() || undefined,
    proxyCount: Number.isInteger(proxyCount) && proxyCount > 0 ? proxyCount : undefined,
  };
}

function asIp(candidate: string | null | undefined): string | null {
  const value = candidate?.trim();
  return value && isIP(value) ? value : null;
}

export function getClientIp(headers: Headers, config: ClientIpConfig = clientIpConfigFromEnv()): string {
  if (config.header) {
    const fromHeader = asIp(headers.get(config.header));
    if (fromHeader) return fromHeader;
    // The first X-Forwarded-For entry is not trustworthy on a host that
    // needs a dedicated header, so only proxyCount may stand in for it.
    if (!config.proxyCount) return UNATTRIBUTED;
  }

  const entries = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);

  if (config.proxyCount) {
    // Fewer entries than trusted hops: the request didn't come through the
    // expected chain, so nothing in it can be trusted.
    if (entries.length < config.proxyCount) return UNATTRIBUTED;
    return asIp(entries[entries.length - config.proxyCount]) ?? UNATTRIBUTED;
  }
  return asIp(entries[0]) ?? UNATTRIBUTED;
}

/** What the request carried, for /api/ops/client-ip (verifying the settings on a new host). */
export function clientIpDiagnostics(headers: Headers) {
  const config = clientIpConfigFromEnv();
  return {
    config,
    resolved: getClientIp(headers, config),
    headers: Object.fromEntries(
      ["x-forwarded-for", "x-real-ip", "true-client-ip", "cf-connecting-ip", "x-envoy-external-address"].map((h) => [h, headers.get(h)]),
    ),
  };
}
