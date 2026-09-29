import "server-only";

/**
 * Extracts the caller's IP from `x-forwarded-for`. This header is trivially
 * spoofable by the CLIENT — it is only trustworthy when a proxy in front of
 * this app OVERWRITES it itself before forwarding the request (Vercel, most
 * PaaS load balancers, and a correctly configured nginx/Cloudflare all do
 * this). Deploying this app directly (bare Node, no such proxy) would let any
 * caller claim any IP by simply setting this header themselves.
 *
 * This is a deployment-topology fact, not something code alone can verify —
 * see docs/ENVIRONMENT_MATRIX.md and docs/STAGING_SETUP_RUNBOOK.md for the
 * explicit requirement that the chosen hosting platform terminates/rewrites
 * this header before it reaches the app.
 */
export function getClientIp(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  // No proxy header present — either a direct local connection (dev) or a
  // misconfigured deployment. Falling back to a single shared bucket here
  // rather than "unknown" per-request keeps the rate limit meaningful (one
  // bucket for all unattributable traffic) instead of accidentally becoming
  // a no-op (a fresh "unknown-<random>" key every time would never collide).
  return "unattributed";
}
