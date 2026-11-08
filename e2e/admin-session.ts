import { createHmac } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { resolveSecretKey } from "../src/lib/supabase/keys";

/** Test-only RFC 6238: the app never computes codes, Supabase Auth does. */
export function totpCode(secretBase32: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secretBase32.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1]! & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

function authAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = resolveSecretKey(process.env)?.key;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required for admin e2e");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

/** Clears a test admin's factors and MFA rate-limit counters so each spec starts from a known state (workers: 1). */
export async function resetAdminFactors(email: string) {
  const admin = authAdmin();
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (error) throw error;
  const user = data.users.find((u) => u.email === email);
  if (!user) throw new Error(`${email} not found; run npm run db:dev-bootstrap`);
  const { data: factors } = await admin.auth.admin.mfa.listFactors({ userId: user.id });
  for (const f of factors?.factors ?? []) await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId: user.id });

  const sql = postgres(process.env.MIGRATIONS_DATABASE_URL!, { max: 1 });
  await sql`delete from rate_limit_hits where key like ${`admin-mfa-%:${user.id}`}`;
  await sql.end();
}

/** Completes the enrollment screen and returns the secret. */
export async function completeMfaEnrollment(page: Page): Promise<string> {
  await expect(page).toHaveURL(/\/admin\/mfa\/setup/);
  const secret = (await page.getByTestId("mfa-secret").textContent())!.trim();
  await page.getByTestId("mfa-code").fill(totpCode(secret));
  await page.getByTestId("mfa-submit").click();
  return secret;
}

/** Password plus a fresh TOTP enrollment: the whole admin sign-in, ending on the dashboard. */
export async function signInAdminWithMfa(page: Page, email: string, password: string) {
  await resetAdminFactors(email);
  await page.goto("/admin/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await completeMfaEnrollment(page);
  await expect(page).toHaveURL(/\/admin\/dashboard/);
}
