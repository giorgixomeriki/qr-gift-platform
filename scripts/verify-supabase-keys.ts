import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  apiKeyHeaders,
  isNewApiKey,
  publishableKeyProblems,
  resolvePublishableKey,
  resolveSecretKey,
  secretKeyProblems,
} from "../src/lib/supabase/keys";

/**
 * Supabase API key migration checks (docs/security/SUPABASE_API_KEY_MIGRATION.md).
 *
 *  1. Resolution: new keys win, legacy is only a fallback, swapped or
 *     browser-exposed elevated keys are refused. Pure, made-up values.
 *  2. Static: nothing reads the raw key variables except the resolver, no
 *     raw request hand-builds a Bearer from a project key, and the browser
 *     env module never touches the secret key.
 *  3. Live, against the LOCAL Supabase stack only (refuses a non-local URL):
 *     header behaviour of the new keys, negative authorization, a signed
 *     upload round trip, and that a signed-in user's own session token —
 *     not the project key — is what authorizes their requests.
 *
 * Never prints a key, token or password: only labels and HTTP statuses.
 */
let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${!ok && detail ? ` — ${detail}` : ""}`);
  if (ok) passed++;
  else failed++;
}

const ROOT = join(__dirname, "..");
const fakeJwt = (role: string) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role, iss: "supabase" })).toString("base64url")}.c2lnbmF0dXJl`;

function resolution() {
  console.log("1. Resolution and validation");
  const pub = "sb_publishable_example";
  const sec = "sb_secret_example";
  const anon = fakeJwt("anon");
  const service = fakeJwt("service_role");

  check("new publishable key wins over legacy anon", resolvePublishableKey({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: pub, NEXT_PUBLIC_SUPABASE_ANON_KEY: anon })?.source === "new");
  check("new secret key wins over legacy service_role", resolveSecretKey({ SUPABASE_SECRET_KEY: sec, SUPABASE_SERVICE_ROLE_KEY: service })?.source === "new");
  check("legacy anon is used only as a fallback", resolvePublishableKey({ NEXT_PUBLIC_SUPABASE_ANON_KEY: anon })?.source === "legacy");
  check("legacy service_role is used only as a fallback", resolveSecretKey({ SUPABASE_SERVICE_ROLE_KEY: service })?.source === "legacy");
  check("blank values count as unset", resolvePublishableKey({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: " ", NEXT_PUBLIC_SUPABASE_ANON_KEY: anon })?.source === "legacy");
  check("no keys at all → refused", publishableKeyProblems({}).length > 0 && secretKeyProblems({}).length > 0);
  check("valid new pair → no problems", publishableKeyProblems({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: pub }).length === 0 && secretKeyProblems({ SUPABASE_SECRET_KEY: sec }).length === 0);
  check("valid legacy pair → no problems", publishableKeyProblems({ NEXT_PUBLIC_SUPABASE_ANON_KEY: anon }).length === 0 && secretKeyProblems({ SUPABASE_SERVICE_ROLE_KEY: service }).length === 0);
  check("secret key in NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY → refused", publishableKeyProblems({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: sec }).length > 0);
  check("service_role JWT in NEXT_PUBLIC_SUPABASE_ANON_KEY → refused", publishableKeyProblems({ NEXT_PUBLIC_SUPABASE_ANON_KEY: service }).length > 0);
  check("service_role JWT in NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY → refused", publishableKeyProblems({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: service }).length > 0);
  check("publishable key in SUPABASE_SECRET_KEY → refused", secretKeyProblems({ SUPABASE_SECRET_KEY: pub }).length > 0);
  check("anon JWT in SUPABASE_SECRET_KEY → refused", secretKeyProblems({ SUPABASE_SECRET_KEY: anon }).length > 0);
  check("problem messages never contain the key", [...publishableKeyProblems({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: sec }), ...secretKeyProblems({ SUPABASE_SECRET_KEY: pub })].every((m) => !m.includes(sec) && !m.includes(pub)));
  check("new keys → apikey header only (no Bearer)", JSON.stringify(Object.keys(apiKeyHeaders(sec))) === '["apikey"]' && JSON.stringify(Object.keys(apiKeyHeaders(pub))) === '["apikey"]');
  check("legacy JWT keys keep their Bearer during the migration", apiKeyHeaders(service).Authorization === `Bearer ${service}`);
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (["node_modules", ".next", ".git"].includes(name)) return [];
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|mjs|js)$/.test(name) ? [p] : [];
  });
}

function staticChecks() {
  console.log("2. Static checks");
  // Files allowed to name the raw variables: the resolver, the two env
  // modules that feed it, and checks that assert on configuration text.
  const allowed = new Set(["src/lib/supabase/keys.ts", "src/lib/env.ts", "src/lib/env.public.ts", "scripts/verify-supabase-keys.ts", "scripts/verify-low-cost-hosting.ts"]);
  const files = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "scripts")), ...walk(join(ROOT, "e2e"))].map((f) => relative(ROOT, f));
  const rawReaders = files.filter((f) => !allowed.has(f) && /process\.env\.(NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY|SUPABASE_SECRET_KEY)/.test(readFileSync(join(ROOT, f), "utf8")));
  check("only the resolver/env modules read the raw key variables", rawReaders.length === 0, rawReaders.join(", "));
  // env.SUPABASE_SECRET_KEY / publicEnv.SUPABASE_PUBLISHABLE_KEY are the RESOLVED
  // values; reading a raw variable through the env objects would bypass that.
  const RAW_FIELD = /\b(?:publicEnv|env)\.(NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)\b/;
  const appRefs = files.filter((f) => !allowed.has(f) && RAW_FIELD.test(readFileSync(join(ROOT, f), "utf8")));
  check("code reads only the resolved keys (env.SUPABASE_SECRET_KEY / publicEnv.SUPABASE_PUBLISHABLE_KEY)", appRefs.length === 0, appRefs.join(", "));
  const handBearer = files.filter((f) => f.startsWith("src/") && !allowed.has(f) && /Bearer \$\{[^}]*(KEY|Key|key)\}/.test(readFileSync(join(ROOT, f), "utf8")));
  check("no hand-built `Bearer ${…key}` (use apiKeyHeaders)", handBearer.length === 0, handBearer.join(", "));
  const pub = readFileSync(join(ROOT, "src/lib/env.public.ts"), "utf8");
  check("browser env module never reads the secret key", !/SUPABASE_SECRET_KEY|SERVICE_ROLE/.test(pub));
  const clientFiles = files.filter((f) => f.startsWith("src/") && /^["']use client["']/m.test(readFileSync(join(ROOT, f), "utf8")));
  const leaky = clientFiles.filter((f) => /SUPABASE_SECRET_KEY|from "@\/lib\/env"/.test(readFileSync(join(ROOT, f), "utf8")));
  check("no client component imports the server env or the secret key", leaky.length === 0, leaky.join(", "));
}

async function status(url: string, init: RequestInit = {}) {
  try {
    const res = await fetch(url, init);
    return { status: res.status, body: await res.text() };
  } catch (err) {
    return { status: 0, body: String(err) };
  }
}

async function live() {
  console.log("3. Live checks (local Supabase)");
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const pub = resolvePublishableKey(process.env);
  const sec = resolveSecretKey(process.env);
  if (!base || !pub || !sec) {
    check("local Supabase URL and keys present", false, "set NEXT_PUBLIC_SUPABASE_URL and the keys");
    return;
  }
  const host = new URL(base).hostname;
  if (!["127.0.0.1", "localhost"].includes(host)) {
    check("refuses to run live checks against a non-local Supabase", true);
    return;
  }
  check("running with NEW-format keys only (not the legacy fallback)", pub.source === "new" && sec.source === "new" && isNewApiKey(pub.key) && isNewApiKey(sec.key));
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "greeting-media";

  // Header behaviour of the project keys.
  check("secret key, apikey header only → Storage admin read OK", (await status(`${base}/storage/v1/bucket/${bucket}`, { headers: apiKeyHeaders(sec.key) })).status === 200);
  check("secret key, apikey header only → Auth admin API OK", (await status(`${base}/auth/v1/admin/users?per_page=1`, { headers: apiKeyHeaders(sec.key) })).status === 200);
  const pubAdmin = await status(`${base}/auth/v1/admin/users?per_page=1`, { headers: apiKeyHeaders(pub.key) });
  check("publishable key → Auth admin API refused", pubAdmin.status === 401 || pubAdmin.status === 403, String(pubAdmin.status));
  const noKey = await status(`${base}/auth/v1/admin/users?per_page=1`);
  check("no key → Auth admin API refused", noKey.status >= 400 && noKey.status < 500, String(noKey.status));
  const pubBucket = await status(`${base}/storage/v1/bucket/${bucket}`, { headers: apiKeyHeaders(pub.key) });
  check("publishable key → private bucket metadata not readable", pubBucket.status >= 400, String(pubBucket.status));
  const forged = await status(`${base}/auth/v1/admin/users?per_page=1`, { headers: { apikey: pub.key, Authorization: `Bearer ${sec.key}` } });
  check("secret key smuggled in Authorization with a publishable apikey → refused", forged.status >= 400, String(forged.status));

  // Signed upload round trip, exactly as the app does it.
  const admin = createClient(base, sec.key, { auth: { persistSession: false, autoRefreshToken: false } });
  const path = `verify-keys/${randomUUID()}.png`;
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d4a3b70000000049454e44ae426082", "hex");
  const { data: slot, error: slotErr } = await admin.storage.from(bucket).createSignedUploadUrl(path);
  check("secret-key SDK client issues a signed upload URL", !slotErr && !!slot?.signedUrl, slotErr?.message);
  if (slot?.signedUrl) {
    const form = new FormData();
    form.append("cacheControl", "3600");
    form.append("", new Blob([png], { type: "image/png" }));
    const put = await status(slot.signedUrl, { method: "PUT", headers: { ...apiKeyHeaders(pub.key), "x-upsert": "false" }, body: form });
    check("browser-style upload: publishable key in apikey only + signed token → stored", put.status === 200, String(put.status));
    const range = await fetch(`${base}/storage/v1/object/${bucket}/${path}`, { headers: { ...apiKeyHeaders(sec.key), Range: "bytes=0-7" } });
    const head = Buffer.from(await range.arrayBuffer());
    check("server Range read with secret key in apikey only (verify-upload) → PNG bytes", range.ok && head.subarray(0, 4).toString("hex") === "89504e47", String(range.status));
    const anonRead = await status(`${base}/storage/v1/object/${bucket}/${path}`, { headers: apiKeyHeaders(pub.key) });
    check("publishable key cannot read the private object", anonRead.status >= 400, String(anonRead.status));
    const publicRead = await status(`${base}/storage/v1/object/public/${bucket}/${path}`);
    check("object is not reachable through the public URL", publicRead.status >= 400, String(publicRead.status));
    const { data: signed } = await admin.storage.from(bucket).createSignedUrl(path, 60);
    check("signed read URL works without any key", !!signed?.signedUrl && (await status(signed.signedUrl)).status === 200);
    const tampered = signed?.signedUrl ? signed.signedUrl.replace(/token=([^&]+)/, (_, t: string) => `token=${t.slice(0, -4)}AAAA`) : "";
    check("tampered signed read URL is refused", !!tampered && (await status(tampered)).status >= 400);
    await admin.storage.from(bucket).remove([path]);
  }

  // A user's own session token authorizes their requests (not the project key).
  const email = `verify-keys-${randomUUID().slice(0, 8)}@example.test`;
  const password = randomBytes(18).toString("base64url"); // in memory only, never printed
  const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  check("secret-key client creates a temporary test user", !createErr && !!created.user, createErr?.message);
  if (created?.user) {
    try {
      const userClient = createClient(base, pub.key, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data: signIn, error: signErr } = await userClient.auth.signInWithPassword({ email, password });
      check("publishable-key client signs a user in", !signErr && !!signIn.session, signErr?.message);
      const token = signIn.session?.access_token ?? "";
      const me = await status(`${base}/auth/v1/user`, { headers: { apikey: pub.key, Authorization: `Bearer ${token}` } });
      check("user session token (Bearer) + publishable apikey → /auth/v1/user is that user", me.status === 200 && me.body.includes(created.user.id), String(me.status));
      const meNoSession = await status(`${base}/auth/v1/user`, { headers: apiKeyHeaders(pub.key) });
      check("publishable key alone is NOT a user session", meNoSession.status >= 400, String(meNoSession.status));
      const { data: got } = await userClient.auth.getUser(token);
      check("SDK getUser(token) resolves the same user", got.user?.id === created.user.id);
      const asAdmin = await status(`${base}/auth/v1/admin/users?per_page=1`, { headers: { apikey: pub.key, Authorization: `Bearer ${token}` } });
      check("a normal user's session cannot use the Auth admin API", asAdmin.status === 401 || asAdmin.status === 403, String(asAdmin.status));
      const bucketAsUser = await status(`${base}/storage/v1/object/list/${bucket}`, {
        method: "POST",
        headers: { apikey: pub.key, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ prefix: "", limit: 5 }),
      });
      check("a normal user's session cannot list private greeting media", bucketAsUser.status >= 400 || bucketAsUser.body.trim() === "[]", String(bucketAsUser.status));
      const alg = JSON.parse(Buffer.from(token.split(".")[0] ?? "", "base64url").toString() || "{}").alg;
      console.log(`    (info) local user tokens are signed with ${alg ?? "unknown"}`);
    } finally {
      await admin.auth.admin.deleteUser(created.user.id);
    }
  }
}

async function main() {
  resolution();
  staticChecks();
  await live();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
