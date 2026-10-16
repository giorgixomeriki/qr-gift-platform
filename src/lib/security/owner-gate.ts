import { NextResponse, type NextRequest } from "next/server";

/**
 * Owner-review access gate: HTTP Basic auth over the whole site, for a
 * deployment that must be reachable on its real domain but not by the public
 * (docs/OWNER_REVIEW_DEPLOYMENT.md). Off unless OWNER_REVIEW_GATE_PASSWORD is
 * set. Runs in middleware (Edge), so it reads process.env directly rather than
 * lib/env.ts. /api/health stays open for uptime checks (it reveals only
 * ok/unavailable) and /api/cron/* has its own bearer secret.
 */
const OPEN_PATHS = [/^\/api\/health$/, /^\/api\/cron\//];

function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export function ownerGateAllows(request: NextRequest): boolean {
  const password = process.env.OWNER_REVIEW_GATE_PASSWORD;
  if (!password) return true;
  if (OPEN_PATHS.some((p) => p.test(request.nextUrl.pathname))) return true;

  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    decoded = atob(header.slice(6));
  } catch {
    return false;
  }
  const sep = decoded.indexOf(":");
  if (sep < 0) return false;
  const user = process.env.OWNER_REVIEW_GATE_USER ?? "owner";
  const userOk = constantTimeEqual(decoded.slice(0, sep), user);
  const passwordOk = constantTimeEqual(decoded.slice(sep + 1), password);
  return userOk && passwordOk;
}

export function ownerGateChallenge(): NextResponse {
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="QR Starr owner review", charset="UTF-8"',
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
