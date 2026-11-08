import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { resolvePublishableKey, resolveSecretKey } from "../src/lib/supabase/keys";

/**
 * Admin sign-in for the browser suite, through the same path production uses:
 * an operator grant from scripts/ops/admin-access.ts, enrollment once, then
 * the normal challenge. Nothing here resets a rate limit.
 */
const STATE_FILE = join(process.cwd(), "node_modules/.cache/e2e-admin-totp.json");

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

function supabaseUrl() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is required for admin e2e");
  return url;
}

function authAdmin() {
  const key = resolveSecretKey(process.env)?.key;
  if (!key) throw new Error("A Supabase secret key is required for admin e2e");
  return createClient(supabaseUrl(), key, { auth: { autoRefreshToken: false, persistSession: false } });
}

/** Run once per suite: drops a previous run's factors, so the dev admin enrolls from a known state. */
export async function resetSuiteAdmin(email: string) {
  rmSync(STATE_FILE, { force: true });
  const admin = authAdmin();
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (error) throw error;
  const user = data.users.find((u) => u.email === email);
  if (!user) return;
  const { data: factors } = await admin.auth.admin.mfa.listFactors({ userId: user.id });
  for (const f of factors?.factors ?? []) await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId: user.id });
  await admin.auth.admin.updateUserById(user.id, { app_metadata: { admin_mfa: null } });
}

function savedSecret(email: string): string | undefined {
  if (!existsSync(STATE_FILE)) return undefined;
  return (JSON.parse(readFileSync(STATE_FILE, "utf8")) as Record<string, string>)[email];
}

function saveSecret(email: string, secret: string) {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  const all = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
  writeFileSync(STATE_FILE, JSON.stringify({ ...all, [email]: secret }), { mode: 0o600 });
}

/** The operator's enrollment grant, by the real tool. */
export function operatorGrant(email: string) {
  execFileSync("./node_modules/.bin/tsx", ["scripts/ops/admin-access.ts", "grant-enrollment", "--email", email, "--reason", "e2e", "--minutes", "15", "--expect-host", new URL(supabaseUrl()).host, "--apply"], { stdio: "pipe", env: process.env });
}

export async function logIn(page: Page, path: string, email: string, password: string) {
  await page.goto(path);
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
}

/** Completes the enrollment screen and returns the secret. */
export async function completeMfaEnrollment(page: Page): Promise<string> {
  await expect(page).toHaveURL(/\/admin\/mfa\/setup/);
  await expect(page.getByTestId("mfa-secret")).toBeVisible();
  const secret = (await page.getByTestId("mfa-secret").innerText()).trim();
  await page.getByTestId("mfa-code").fill(totpCode(secret));
  await page.getByTestId("mfa-submit").click();
  return secret;
}

/** Enrolls on first use, then signs in with a current code, ending on the dashboard. */
export async function signInAdminWithMfa(page: Page, email: string, password: string) {
  await logIn(page, "/admin/login", email, password);
  await page.waitForURL(/\/admin\/(mfa|dashboard)/);
  if (page.url().includes("/admin/mfa/locked")) {
    operatorGrant(email);
    await page.goto("/admin/mfa/setup");
  }
  if (page.url().includes("/admin/mfa/setup")) {
    saveSecret(email, await completeMfaEnrollment(page));
  } else {
    await page.getByTestId("mfa-code").fill(totpCode(savedSecret(email)!));
    await page.getByTestId("mfa-submit").click();
  }
  await expect(page).toHaveURL(/\/admin\/dashboard/);
}

/** A fresh admin for one test, so its rate-limit counters and factors are its own. */
export async function createThrowawayAdmin() {
  const admin = authAdmin();
  const email = `mfa-e2e-${crypto.randomUUID().slice(0, 8)}@dev.local`;
  const password = `e2e-${crypto.randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const sql = postgres(process.env.MIGRATIONS_DATABASE_URL!, { max: 1 });
  await sql`insert into admin_users (user_id) values (${data.user.id})`;
  return {
    email,
    password,
    cleanup: async () => {
      await sql`delete from audit_logs where actor_id = ${data.user.id}`;
      await sql`delete from admin_users where user_id = ${data.user.id}`;
      await sql.end();
      await admin.auth.admin.deleteUser(data.user.id);
    },
  };
}

/** What an attacker with only the password can do: enroll directly against Supabase. */
export async function enrollDirectlyAgainstSupabase(email: string, password: string) {
  const client = createClient(supabaseUrl(), resolvePublishableKey(process.env)!.key, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  const { data, error } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "direct" });
  if (error) throw error;
  const { error: verifyError } = await client.auth.mfa.challengeAndVerify({ factorId: data.id, code: totpCode(data.totp.secret) });
  if (verifyError) throw verifyError;
}
