/**
 * Turns whatever the admin scanner read (a QR payload) or typed (manual
 * fallback) into a QR STARR public token — or rejects it. Pure and shared by
 * the client (instant feedback, no request for a foreign QR) and the server
 * (the authoritative check: a client result is never trusted).
 *
 * Accepted:
 *   <approved origin>/g/<TOKEN>      exactly the URL printed on the card
 *                                    (lib/qr/asset.ts publicQrUrl), optional
 *                                    trailing slash, no query or fragment
 *   <TOKEN>                          24 chars of the card alphabet (manual)
 * Everything else — other hosts, look-alike hosts, other paths, extra
 * segments, credentials in the URL — is "foreign".
 */

// Same alphabet as lib/security/public-token.ts (kept here so this module has
// no nanoid/server dependency and can run in the browser).
const TOKEN_RE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{24}$/;

/** Production hosts the cards are printed with, plus the running app's own origin. */
const CANONICAL_ORIGINS = ["https://qrapp.ge", "https://www.qrapp.ge"];

export type ScanParse = { ok: true; token: string } | { ok: false; reason: "empty" | "foreign" | "malformed" };

export function approvedOrigins(appUrl: string | undefined): string[] {
  const origins = new Set(CANONICAL_ORIGINS);
  if (appUrl) {
    try {
      origins.add(new URL(appUrl).origin);
    } catch {
      // A malformed app URL adds nothing.
    }
  }
  return [...origins];
}

export function isPublicToken(value: string): boolean {
  return TOKEN_RE.test(value);
}

export function parseScannedQr(raw: unknown, appUrl: string | undefined): ScanParse {
  if (typeof raw !== "string") return { ok: false, reason: "malformed" };
  const value = raw.trim();
  if (!value) return { ok: false, reason: "empty" };
  if (value.length > 512) return { ok: false, reason: "foreign" };

  const upper = value.toUpperCase();
  if (isPublicToken(upper)) return { ok: true, token: upper };

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "foreign" };
  }
  if (url.username || url.password || url.search || url.hash) return { ok: false, reason: "foreign" };
  if (!approvedOrigins(appUrl).includes(url.origin)) return { ok: false, reason: "foreign" };

  const match = /^\/g\/([^/]+)\/?$/.exec(url.pathname);
  if (!match) return { ok: false, reason: "foreign" };
  const token = match[1]!;
  if (!isPublicToken(token)) return { ok: false, reason: "malformed" };
  return { ok: true, token };
}

/** Last four characters — enough to tell selected cards apart on screen without showing the full credential. */
export function tokenHint(token: string): string {
  return `…${token.slice(-4)}`;
}
