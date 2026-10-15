import type { z } from "zod";
import { tokenResponseSchema } from "./schemas";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 10_000;
const REFRESH_EARLY_MS = 60_000;
const MAX_TOKEN_LIFETIME_MS = 60 * 60_000;
const FALLBACK_TOKEN_LIFETIME_MS = 5 * 60_000;

/**
 * A BOG API call failed. The message carries the HTTP status and BOG's own
 * error key/message only — never request bodies, tokens or credentials.
 */
export class BogApiError extends Error {
  constructor(
    readonly status: number,
    readonly bogKey: string | undefined,
    message: string,
    /** Whether retrying the same request (same Idempotency-Key) is safe and useful. */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "BogApiError";
  }
}

/** Reads `exp` from a JWT without verifying it — only to schedule a refresh, never to trust it. */
function jwtExpiryMs(token: string): number | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const exp = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).exp;
    return typeof exp === "number" ? exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

/**
 * OAuth2 client-credentials token for BOG (HTTP Basic client_id:secret,
 * grant_type=client_credentials). Cached until shortly before expiry and
 * shared by concurrent callers (one request in flight at a time). Expiry
 * comes from the JWT's exp when present: the documented `expires_in` example
 * is implausible, so it is only a capped fallback.
 */
export class BogTokenClient {
  private token?: { value: string; refreshAt: number };
  private inFlight?: Promise<string>;

  constructor(
    private readonly config: { tokenUrl: string; clientId: string; clientSecret: string },
    private readonly fetchImpl: FetchLike,
    private readonly now: () => number = Date.now,
  ) {}

  async getToken(): Promise<string> {
    if (this.token && this.now() < this.token.refreshAt) return this.token.value;
    this.inFlight ??= this.fetchToken().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  invalidate(): void {
    this.token = undefined;
  }

  private async fetchToken(): Promise<string> {
    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64");
    let res: Response;
    try {
      res = await this.fetchImpl(this.config.tokenUrl, {
        method: "POST",
        headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new BogApiError(0, undefined, `BOG token request failed: ${err instanceof Error ? err.name : "error"}`, true);
    }
    if (!res.ok) {
      throw new BogApiError(res.status, undefined, `BOG token request returned ${res.status}`, res.status >= 500);
    }
    const parsed = tokenResponseSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new BogApiError(res.status, undefined, "BOG token response has an unexpected shape", false);

    const now = this.now();
    const fromJwt = jwtExpiryMs(parsed.data.access_token);
    const fromExpiresIn =
      parsed.data.expires_in && parsed.data.expires_in > 0 && parsed.data.expires_in < 86_400
        ? now + parsed.data.expires_in * 1000
        : undefined;
    const expiresAt = Math.min(fromJwt ?? fromExpiresIn ?? now + FALLBACK_TOKEN_LIFETIME_MS, now + MAX_TOKEN_LIFETIME_MS);
    this.token = { value: parsed.data.access_token, refreshAt: expiresAt - REFRESH_EARLY_MS };
    return parsed.data.access_token;
  }
}

/**
 * Authenticated JSON call to BOG. Re-authenticates once on 401. Retries once
 * more on a network error or 5xx only when the caller marks the request as
 * idempotent (an Idempotency-Key header or a GET), so a retry can never
 * create a second order or a second refund.
 */
export async function bogRequest<S extends z.ZodTypeAny>(
  deps: { fetchImpl: FetchLike; tokens: BogTokenClient },
  req: { method: "GET" | "POST"; url: string; body?: unknown; headers?: Record<string, string>; idempotent: boolean },
  schema: S,
): Promise<z.infer<S>> {
  let reauthenticated = false;
  let retried = false;
  for (;;) {
    let res: Response;
    try {
      const token = await deps.tokens.getToken();
      res = await deps.fetchImpl(req.url, {
        method: req.method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(req.body === undefined ? {} : { "Content-Type": "application/json" }),
          ...req.headers,
        },
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const apiErr = err instanceof BogApiError ? err : new BogApiError(0, undefined, `BOG request failed: ${err instanceof Error ? err.name : "error"}`, true);
      if (apiErr.retryable && req.idempotent && !retried) {
        retried = true;
        continue;
      }
      throw apiErr;
    }

    if (res.status === 401 && !reauthenticated) {
      reauthenticated = true;
      deps.tokens.invalidate();
      continue;
    }
    if (res.status >= 500 && req.idempotent && !retried) {
      retried = true;
      continue;
    }

    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const key = json && typeof json === "object" && "key" in json ? String((json as { key: unknown }).key) : undefined;
      throw new BogApiError(res.status, key, `BOG ${req.method} returned ${res.status}${key ? ` (${key})` : ""}`, res.status >= 500);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new BogApiError(res.status, undefined, `BOG ${req.method} response has an unexpected shape`, false);
    return parsed.data;
  }
}
