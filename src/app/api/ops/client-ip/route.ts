import { env } from "@/lib/env";
import { clientIpDiagnostics } from "@/lib/rate-limit/client-ip";

/**
 * Verifies CLIENT_IP_HEADER / TRUSTED_PROXY_COUNT on a new host
 * (docs/RENDER_DEPLOYMENT.md): echoes the caller's OWN forwarding headers and
 * the IP the rate limiter would key on. Exists only while
 * CLIENT_IP_DIAGNOSTICS=true. Never cached.
 */
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  if (!env.CLIENT_IP_DIAGNOSTICS) return new Response("Not found", { status: 404 });
  return Response.json(clientIpDiagnostics(request.headers), { headers: { "Cache-Control": "no-store" } });
}
