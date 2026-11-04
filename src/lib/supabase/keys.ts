/**
 * Supabase API key resolution (migration from the legacy JWT keys to the new
 * publishable/secret keys: docs/security/SUPABASE_API_KEY_MIGRATION.md).
 *
 *   publishable  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (sb_publishable_…),
 *                else the legacy NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   secret       SUPABASE_SECRET_KEY (sb_secret_…),
 *                else the legacy SUPABASE_SERVICE_ROLE_KEY
 *
 * The legacy fallback is TEMPORARY: it lets the new code ship before the new
 * keys are configured, and it is removed once the legacy keys are disabled
 * (Stage 4). Nothing else in the app may read the four variables directly;
 * `npm run verify:supabase-keys` checks that.
 *
 * Pure and client-safe: no `server-only`, and nothing here ever returns or
 * logs a key value. Problems name variables, never values.
 */

export type KeySource = "new" | "legacy";

type Source = Record<string, string | undefined>;

const PUBLISHABLE_PREFIX = "sb_publishable_";
const SECRET_PREFIX = "sb_secret_";

const blank = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

/** True for the new-format (non-JWT) keys, which belong only in the `apikey` header. */
export function isNewApiKey(key: string): boolean {
  return key.startsWith(PUBLISHABLE_PREFIX) || key.startsWith(SECRET_PREFIX);
}

/** The `role` claim of a legacy JWT key, read without verifying it — only to catch a swapped variable. */
function legacyRole(key: string): string | null {
  const payload = key.split(".")[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(typeof atob === "function" ? atob(payload.replace(/-/g, "+").replace(/_/g, "/")) : Buffer.from(payload, "base64url").toString());
    return typeof json?.role === "string" ? json.role : null;
  } catch {
    return null;
  }
}

export function resolvePublishableKey(source: Source): { key: string; source: KeySource } | null {
  const next = blank(source.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  if (next) return { key: next, source: "new" };
  const legacy = blank(source.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return legacy ? { key: legacy, source: "legacy" } : null;
}

export function resolveSecretKey(source: Source): { key: string; source: KeySource } | null {
  const next = blank(source.SUPABASE_SECRET_KEY);
  if (next) return { key: next, source: "new" };
  const legacy = blank(source.SUPABASE_SERVICE_ROLE_KEY);
  return legacy ? { key: legacy, source: "legacy" } : null;
}

/**
 * Fail-closed checks: a missing key, a key in the wrong variable, or an
 * elevated key exposed through a NEXT_PUBLIC_ variable.
 */
export function publishableKeyProblems(source: Source): string[] {
  const problems: string[] = [];
  const next = blank(source.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  const legacy = blank(source.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (!next && !legacy) problems.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or legacy NEXT_PUBLIC_SUPABASE_ANON_KEY) is required");
  if (next && !next.startsWith(PUBLISHABLE_PREFIX) && !next.includes(".")) {
    problems.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not a publishable key (expected sb_publishable_…)");
  }
  // An elevated key in a NEXT_PUBLIC_ variable would be inlined into the browser bundle.
  for (const [name, value] of [
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", next],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", legacy],
  ] as const) {
    if (!value) continue;
    if (value.startsWith(SECRET_PREFIX) || legacyRole(value) === "service_role") {
      problems.push(`${name} holds an elevated (secret/service_role) key — it would be shipped to browsers`);
    }
  }
  return problems;
}

export function secretKeyProblems(source: Source): string[] {
  const problems: string[] = [];
  const next = blank(source.SUPABASE_SECRET_KEY);
  const legacy = blank(source.SUPABASE_SERVICE_ROLE_KEY);
  if (!next && !legacy) problems.push("SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY) is required");
  if (next && (next.startsWith(PUBLISHABLE_PREFIX) || (!next.startsWith(SECRET_PREFIX) && !next.includes(".")))) {
    problems.push("SUPABASE_SECRET_KEY is not a secret key (expected sb_secret_…)");
  }
  if (next && next.includes(".") && legacyRole(next) !== "service_role") {
    problems.push("SUPABASE_SECRET_KEY holds a non-service_role JWT");
  }
  return problems;
}

/**
 * Headers for a raw (non-SDK) call to Supabase with a project API key and no
 * user session. New keys go only in `apikey` (Supabase: "not on
 * Authorization: Bearer"); legacy JWT keys keep the Bearer they always had.
 */
export function apiKeyHeaders(key: string): Record<string, string> {
  return isNewApiKey(key) ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` };
}
