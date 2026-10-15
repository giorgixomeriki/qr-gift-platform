/**
 * Pure deployment-safety checks over environment values, shared by
 * lib/env.ts (server) and lib/env.public.ts (client + server). No secrets are
 * imported or logged here — callers pass values in, and every message names
 * the variable, never its value. Covered by scripts/verify-env-guards.ts.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

// The fixed LOCAL-DEV-ONLY app_runtime password committed in
// migrations/0001_rls_and_functions.sql (audit finding F-01). Public by
// design for local stacks; on any non-local database it is a known credential.
const PUBLIC_DEV_APP_RUNTIME_PASSWORD = "HH1mUPcwnyz1NGyM8jbeLsQqbwc";

// Postgres roles that bypass RLS. The app must run as app_runtime instead.
// Supabase's pooler spells users as "<role>.<project-ref>".
const SUPERUSER_ROLES = new Set(["postgres", "supabase_admin"]);

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

/**
 * NEXT_PUBLIC_APP_URL is baked into printed QR codes, payment return URLs and
 * auth emails, so in production it must be set explicitly (no localhost
 * default) and be a bare origin: no path, query, fragment or trailing slash.
 */
export function appUrlProblems(
  value: string | undefined,
  opts: { production: boolean; hosted: boolean },
): string[] {
  if (!opts.production) return [];
  if (!value) return ["NEXT_PUBLIC_APP_URL must be set explicitly in production"];

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return ["NEXT_PUBLIC_APP_URL is not a valid URL"];
  }

  const problems: string[] = [];
  if (value !== url.origin) {
    problems.push("NEXT_PUBLIC_APP_URL must be a bare origin (e.g. https://qrapp.ge) with no path or trailing slash");
  }
  if (opts.hosted) {
    if (url.protocol !== "https:") problems.push("NEXT_PUBLIC_APP_URL must use https on a hosted deployment");
    if (isLoopbackHost(url.hostname)) problems.push("NEXT_PUBLIC_APP_URL must not be a loopback host on a hosted deployment");
  }
  return problems;
}

/**
 * The runtime database connection must be the restricted app_runtime role,
 * must not carry the public dev password anywhere but a local database, and a
 * hosted deployment must never point at a local (development) database.
 */
export function databaseUrlProblems(
  value: string,
  opts: { production: boolean; hosted: boolean },
): string[] {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return ["DATABASE_URL is not a valid connection URL"];
  }

  const problems: string[] = [];
  const local = isLoopbackHost(url.hostname);
  const role = decodeURIComponent(url.username).split(".")[0] ?? "";

  if (!local && decodeURIComponent(url.password) === PUBLIC_DEV_APP_RUNTIME_PASSWORD) {
    problems.push(
      "DATABASE_URL uses the public local-dev app_runtime password on a non-local database — rotate it (docs/PRODUCTION_DEPLOYMENT.md)",
    );
  }
  if (opts.production && SUPERUSER_ROLES.has(role)) {
    problems.push("DATABASE_URL must use the restricted app_runtime role, not a superuser, in production");
  }
  if (opts.hosted && local) {
    problems.push("DATABASE_URL points at a local database on a hosted deployment");
  }
  return problems;
}

/** A hosted deployment must talk to a hosted Supabase project over https. */
export function supabaseUrlProblems(value: string, opts: { hosted: boolean }): string[] {
  if (!opts.hosted) return [];
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return ["NEXT_PUBLIC_SUPABASE_URL is not a valid URL"];
  }
  const problems: string[] = [];
  if (url.protocol !== "https:") problems.push("NEXT_PUBLIC_SUPABASE_URL must use https on a hosted deployment");
  if (isLoopbackHost(url.hostname)) problems.push("NEXT_PUBLIC_SUPABASE_URL points at a local Supabase on a hosted deployment");
  return problems;
}

/**
 * On a hosted deployment the BOG adapter may only talk to Bank of Georgia
 * itself over https — never a stub, a local server or a look-alike host.
 */
export function bogUrlProblems(input: { apiBaseUrl: string; tokenUrl: string; hosted: boolean }): string[] {
  if (!input.hosted) return [];
  const problems: string[] = [];
  for (const [name, value] of [["BOG_API_BASE_URL", input.apiBaseUrl], ["BOG_OAUTH_TOKEN_URL", input.tokenUrl]] as const) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      problems.push(`${name} is not a valid URL`);
      continue;
    }
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:") problems.push(`${name} must use https on a hosted deployment`);
    if (host !== "bog.ge" && !host.endsWith(".bog.ge")) problems.push(`${name} must be a bog.ge host on a hosted deployment`);
  }
  return problems;
}
