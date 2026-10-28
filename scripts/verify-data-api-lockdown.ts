import Module from "node:module";

// Same server-only shim as the other verify-*.ts scripts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ModuleInternals = Module as any;
const nodeModuleLoad = ModuleInternals._load;
ModuleInternals._load = function (request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  return nodeModuleLoad.call(this, request, ...rest);
};

/**
 * SEC-01 (migration 0020): the Supabase Data API (PostgREST /rest/v1, RPC,
 * /graphql/v1) must expose nothing in the `public` schema. The app reaches its
 * tables only as app_runtime over a direct Postgres connection; the anon key
 * ships in the browser bundle, so anything `anon` or `authenticated` can reach
 * is reachable by anyone on the internet.
 *
 * Three parts, each against its own fixtures (cleaned up at the end):
 *   A. Catalog: no schema/table/sequence/function privilege or default
 *      privilege for anon, authenticated or service_role; every policy is
 *      scoped TO app_runtime; app_runtime keeps exactly what it had.
 *   B. HTTP: as anon, as a signed-in user and with the service-role key,
 *      nothing can be listed (QR tokens, greetings, content…) or written
 *      (rate-limit counters, audit/analytics rows, reports, QR state), no
 *      app_* function can be called over RPC, and GraphQL returns no data.
 *   C. app_runtime still works: public QR lookup, RLS still hides admin rows,
 *      the rate-limit counter upsert still succeeds.
 *
 * LOCKDOWN_READ_ONLY=1 is the post-deploy check for a hosted project: part A
 * plus anon / service-role reads and RPC calls against existing rows only —
 * no fixtures, no auth user, no writes. Prints row COUNTS only if a read
 * succeeds, never row contents.
 */
const postgres = require("postgres") as typeof import("postgres");
const { createClient } = require("@supabase/supabase-js") as typeof import("@supabase/supabase-js");

const migrationsUrl = process.env.MIGRATIONS_DATABASE_URL;
const runtimeUrl = process.env.DATABASE_URL;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!migrationsUrl || !runtimeUrl || !supabaseUrl || !anonKey || !serviceKey) {
  throw new Error("MIGRATIONS_DATABASE_URL, DATABASE_URL and Supabase env vars are required");
}
const admin = postgres(migrationsUrl, { max: 1 });
const runtime = postgres(runtimeUrl, { max: 1 });

const CLIENT_ROLES = ["anon", "authenticated"] as const;
const RUNTIME_HELPERS = [
  "app_current_user_id()",
  "app_partner_role(uuid)",
  "app_is_partner_member(uuid)",
  "app_is_admin()",
  "app_greeting_partner_id(uuid)",
  "app_partner_commission_rate_bps(uuid)",
  "app_partner_is_active(uuid)",
  "app_greeting_purchase_blocker(uuid,boolean)",
  "app_lock_partner_balance(uuid,text)",
];

function first<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error("expected a row");
  return row;
}

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail === undefined ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  }
}

const marker = `SECV${crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
const token = (suffix: string) => `${marker}${suffix}`.padEnd(24, "Z").slice(0, 24);
const escalationUserId = crypto.randomUUID();

type Fixtures = { partnerId: string; batchId: string; availableToken: string; activeToken: string; greetingId: string; rateKey: string };

async function createFixtures(): Promise<Fixtures> {
  const partner = first(await admin`insert into partners (name, slug) values (${`Lockdown ${marker}`}, ${`lockdown-${marker.toLowerCase()}`}) returning id`);
  const batch = first(await admin`insert into qr_batches (partner_id, label, quantity) values (${partner.id}, ${`lockdown ${marker}`}, 2) returning id`);
  const availableToken = token("AV");
  const activeToken = token("AC");
  const themeRow = first(await admin`select id from themes order by key limit 1`);
  const productRow = first(await admin`select id from products order by key limit 1`);
  let greetingId = "";
  await admin.begin(async (tx) => {
    await tx`insert into qr_codes (public_token, batch_id, partner_id) values (${availableToken}, ${batch.id}, ${partner.id}), (${activeToken}, ${batch.id}, ${partner.id})`;
    const qr = first(await tx`select id from qr_codes where public_token = ${activeToken}`);
    const g = first(await tx`insert into greetings (qr_code_id, theme_id, product_id, status, activated_at) values (${qr.id}, ${themeRow.id}, ${productRow.id}, 'ACTIVE', now()) returning id`);
    greetingId = g.id;
    await tx`update qr_codes set status = 'ACTIVE', activated_at = now() where id = ${qr.id}`;
    await tx`insert into greeting_content (greeting_id, type, slot, text_value, status) values (${g.id}, 'text', 0, ${`private message ${marker}`}, 'READY')`;
  });
  const rateKey = `lockdown:${marker}`;
  await admin`insert into rate_limit_hits (key, window_start, count) values (${rateKey}, date_trunc('minute', now()), 7)`;
  return { partnerId: partner.id, batchId: batch.id, availableToken, activeToken, greetingId, rateKey };
}

async function cleanup(f: Fixtures | null, authUserId: string | null) {
  if (authUserId) {
    const service = createClient(supabaseUrl!, serviceKey!, { auth: { persistSession: false } });
    await service.auth.admin.deleteUser(authUserId);
  }
  await admin`delete from admin_users where user_id = ${escalationUserId}`;
  await admin`delete from rate_limit_hits where key like ${`lockdown:${marker}%`}`;
  await admin`delete from audit_logs where action like ${`${marker}%`}`;
  await admin`delete from analytics_events where metadata->>'marker' = ${marker}`;
  if (!f) return;
  await admin`delete from reports where greeting_id = ${f.greetingId}`;
  await admin`delete from analytics_events where partner_id = ${f.partnerId}`;
  await admin.begin(async (tx) => {
    await tx`delete from greeting_content where greeting_id = ${f.greetingId}`;
    await tx`update qr_codes set status = 'AVAILABLE', activated_at = null where batch_id = ${f.batchId}`;
    await tx`delete from greetings where id = ${f.greetingId}`;
  });
  await admin`delete from qr_codes where batch_id = ${f.batchId}`;
  await admin`delete from qr_batches where id = ${f.batchId}`;
  await admin`delete from partners where id = ${f.partnerId}`;
}

async function catalogChecks() {
  console.log("\n--- A. Catalog ---");
  for (const role of CLIENT_ROLES) {
    const { usage } = first(await admin`select has_schema_privilege(${role}, 'public', 'usage') as usage`);
    check(`A1. ${role} has no USAGE on schema public (directly or via PUBLIC)`, usage === false);
  }

  const tablePrivs = await admin`
    select grantee, table_name, privilege_type from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')`;
  check("A2. anon/authenticated/service_role/PUBLIC hold no privilege on any public table", tablePrivs.length === 0, tablePrivs.slice(0, 5));

  const colPrivs = await admin`
    select grantee, count(*)::int as n from information_schema.column_privileges
    where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC') group by grantee`;
  check("A3. …and no column-level privilege either", colPrivs.length === 0, colPrivs);

  const seqPrivs = await admin`
    select c.relname, r.rolname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('anon'), ('authenticated'), ('service_role')) as r(rolname)
    where n.nspname = 'public' and c.relkind = 'S'
      and (has_sequence_privilege(r.rolname, c.oid, 'usage') or has_sequence_privilege(r.rolname, c.oid, 'select') or has_sequence_privilege(r.rolname, c.oid, 'update'))`;
  check("A4. No public sequence is usable by a Data API role", seqPrivs.length === 0, seqPrivs);

  const fnPrivs = await admin`
    select p.oid::regprocedure::text as fn, r.rolname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join (values ('anon'), ('authenticated'), ('service_role')) as r(rolname)
    where n.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and p.proacl is not null and exists (select 1 from aclexplode(p.proacl) a where a.grantee = (select oid from pg_roles where rolname = r.rolname))`;
  check("A5. No application function has an explicit EXECUTE grant to a Data API role", fnPrivs.length === 0, fnPrivs.slice(0, 5));

  const defaults = await admin`
    select pg_get_userbyid(d.defaclrole) as for_role, d.defaclobjtype as kind, a.grantee::regrole::text as grantee
    from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
    cross join lateral aclexplode(d.defaclacl) a
    where n.nspname = 'public' and pg_get_userbyid(d.defaclrole) = 'postgres'
      and a.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated', 'service_role'))`;
  check("A6. postgres-owned future objects in public grant nothing to Data API roles", defaults.length === 0, defaults);

  const policies = await admin`select tablename, policyname, roles from pg_policies where schemaname = 'public' and roles <> '{app_runtime}'::name[]`;
  const { total } = first(await admin`select count(*)::int as total from pg_policies where schemaname = 'public'`);
  check(`A7. All ${total} public RLS policies apply TO app_runtime only`, policies.length === 0 && total > 0, policies.slice(0, 5));

  const unprotected = await admin`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`;
  check("A8. RLS remains enabled on every public table", unprotected.length === 0, unprotected);

  const { usage: runtimeUsage } = first(await admin`select has_schema_privilege('app_runtime', 'public', 'usage') as usage`);
  check("A9. app_runtime keeps USAGE on schema public", runtimeUsage === true);
  const runtimeGaps = await admin`
    select c.relname, p.priv from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('select'), ('insert'), ('update'), ('delete')) as p(priv)
    where n.nspname = 'public' and c.relkind = 'r' and not has_table_privilege('app_runtime', c.oid, p.priv)
      and c.relname not in ('partner_payout_items', 'payment_refunds')`;
  check("A10. app_runtime keeps SELECT/INSERT/UPDATE/DELETE on application tables", runtimeGaps.length === 0, runtimeGaps.slice(0, 5));
  const helperGaps: string[] = [];
  for (const fn of RUNTIME_HELPERS) {
    const { ok } = first(await admin`select has_function_privilege('app_runtime', ${fn}::regprocedure, 'execute') as ok`);
    if (!ok) helperGaps.push(fn);
  }
  check("A11. app_runtime keeps EXECUTE on every RLS/checkout helper", helperGaps.length === 0, helperGaps);
}

async function rest(method: string, path: string, key: string, bearer: string, body?: unknown) {
  const res = await fetch(`${supabaseUrl}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
      // return=minimal: with return=representation an INSERT whose new row
      // fails the SELECT policy is rejected anyway, which would hide a write
      // that RLS's INSERT policy actually allows.
      Prefer: "return=minimal",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text };
}

const denied = (r: { status: number }) => r.status >= 400;

async function httpChecks(f: Fixtures, principals: { label: string; key: string; bearer: string }[]) {
  const tables = (await admin`select tablename from pg_tables where schemaname = 'public' order by 1`).map((r) => r.tablename as string);

  for (const p of principals) {
    console.log(`\n--- B. Data API as ${p.label} ---`);
    const readable: string[] = [];
    for (const t of tables) {
      const r = await rest("GET", `/rest/v1/${t}?limit=5`, p.key, p.bearer);
      if (!denied(r) && r.text.trim() !== "[]") readable.push(`${t}:${r.status}`);
    }
    check(`B1. ${p.label}: no public table returns rows (${tables.length} tables)`, readable.length === 0, readable);

    const list = await rest("GET", `/rest/v1/qr_codes?select=public_token`, p.key, p.bearer);
    check(`B2. ${p.label}: cannot list QR tokens`, denied(list) && !list.text.includes(marker), `${list.status} ${list.text.slice(0, 120)}`);
    const byToken = await rest("GET", `/rest/v1/qr_codes?public_token=eq.${f.activeToken}`, p.key, p.bearer);
    check(`B3. ${p.label}: cannot look up a QR row even with its exact token`, denied(byToken) && !byToken.text.includes(marker), byToken.status);
    const greetings = await rest("GET", `/rest/v1/greetings?id=eq.${f.greetingId}`, p.key, p.bearer);
    check(`B4. ${p.label}: cannot read greetings`, denied(greetings) && !greetings.text.includes(f.greetingId), greetings.status);
    const content = await rest("GET", `/rest/v1/greeting_content?select=text_value,storage_key`, p.key, p.bearer);
    check(`B5. ${p.label}: cannot read greeting content`, denied(content) && !content.text.includes(marker), content.status);

    const del = await rest("DELETE", `/rest/v1/rate_limit_hits?key=eq.${encodeURIComponent(f.rateKey)}`, p.key, p.bearer);
    const patch = await rest("PATCH", `/rest/v1/rate_limit_hits?key=eq.${encodeURIComponent(f.rateKey)}`, p.key, p.bearer, { count: 0 });
    const ins = await rest("POST", `/rest/v1/rate_limit_hits`, p.key, p.bearer, { key: `${f.rateKey}:${p.label}`, window_start: new Date().toISOString(), count: 999 });
    const rate = (await admin`select count from rate_limit_hits where key = ${f.rateKey}`)[0];
    const { n: injected } = first(await admin`select count(*)::int as n from rate_limit_hits where key = ${`${f.rateKey}:${p.label}`}`);
    check(
      `B6. ${p.label}: cannot delete, reset or inject rate-limit counters`,
      denied(del) && denied(patch) && denied(ins) && rate?.count === 7 && injected === 0,
      { del: del.status, patch: patch.status, ins: ins.status, count: rate?.count, injected },
    );

    const audit = await rest("POST", `/rest/v1/audit_logs`, p.key, p.bearer, { actor_type: "ADMIN", action: `${marker}_FORGED`, target_type: "x", target_id: "x" });
    const analytics = await rest("POST", `/rest/v1/analytics_events`, p.key, p.bearer, { event_type: "QR_SCANNED", metadata: { marker } });
    const report = await rest("POST", `/rest/v1/reports`, p.key, p.bearer, { greeting_id: f.greetingId, reason: "spam" });
    const { n: forged } = first(await admin`select (select count(*) from audit_logs where action like ${`${marker}%`}) + (select count(*) from analytics_events where metadata->>'marker' = ${marker}) + (select count(*) from reports where greeting_id = ${f.greetingId}) as n`);
    check(
      `B7. ${p.label}: cannot forge audit logs, analytics events or reports`,
      denied(audit) && denied(analytics) && denied(report) && Number(forged) === 0,
      { audit: audit.status, analytics: analytics.status, report: report.status, forged },
    );

    const claim = await rest("PATCH", `/rest/v1/qr_codes?public_token=eq.${f.availableToken}`, p.key, p.bearer, { status: "BLOCKED" });
    const escalate = await rest("POST", `/rest/v1/admin_users`, p.key, p.bearer, { user_id: escalationUserId });
    const qr = first(await admin`select status from qr_codes where public_token = ${f.availableToken}`);
    const { n: admins } = first(await admin`select count(*)::int as n from admin_users where user_id = ${escalationUserId}`);
    check(`B8. ${p.label}: cannot change QR state or add admin rows`, denied(claim) && denied(escalate) && qr.status === "AVAILABLE" && admins === 0, {
      claim: claim.status,
      escalate: escalate.status,
      status: qr.status,
      admins,
    });

    const rpcOpen: string[] = [];
    for (const [fn, body] of [
      ["app_is_admin", {}],
      ["app_current_user_id", {}],
      ["app_partner_role", { p_partner_id: f.partnerId }],
      ["app_greeting_partner_id", { p_greeting_id: f.greetingId }],
      ["app_partner_commission_rate_bps", { p_partner_id: f.partnerId }],
      ["app_lock_partner_balance", { p_partner_id: f.partnerId, p_currency: "GEL" }],
    ] as const) {
      const r = await rest("POST", `/rest/v1/rpc/${fn}`, p.key, p.bearer, body);
      if (!denied(r)) rpcOpen.push(`${fn}:${r.status}`);
    }
    check(`B9. ${p.label}: no app_* function is callable over RPC`, rpcOpen.length === 0, rpcOpen);

    const gql = await rest("POST", `/graphql/v1`, p.key, p.bearer, {
      query: "{ qr_codesCollection(first: 50) { edges { node { public_token } } } greeting_contentCollection(first: 50) { edges { node { text_value } } } }",
    });
    check(`B10. ${p.label}: GraphQL returns no application data`, !gql.text.includes(marker) && !/"public_token"\s*:\s*"/.test(gql.text), `${gql.status} ${gql.text.slice(0, 160)}`);
  }
}

async function runtimeChecks(f: Fixtures) {
  console.log("\n--- C. app_runtime (the application's own connection) ---");
  const qr = await runtime.begin(async (tx) => tx`select public_token, status from qr_codes where public_token = ${f.activeToken}`);
  check("C1. Public QR lookup by token still works", qr.length === 1 && qr[0]?.status === "ACTIVE");
  const content = await runtime.begin(async (tx) => tx`select text_value from greeting_content where greeting_id = ${f.greetingId}`);
  check("C2. ACTIVE greeting content is still readable for the recipient flow", content.length === 1);
  const admins = await runtime.begin(async (tx) => tx`select id from admin_users`);
  check("C3. RLS still applies to app_runtime with no actor context (admin_users hidden)", admins.length === 0);
  const [hit] = await runtime.begin(
    async (tx) => tx`insert into rate_limit_hits (key, window_start) values (${`${f.rateKey}:runtime`}, date_trunc('minute', now()))
                    on conflict (key, window_start) do update set count = rate_limit_hits.count + 1 returning count`,
  );
  check("C4. Rate-limit counter upsert still works", hit?.count === 1);
  const asAdmin = await runtime.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${crypto.randomUUID()}, true)`;
    return tx`select app_is_admin() as is_admin`;
  });
  check("C5. RLS helper functions still execute (app_is_admin() = false for a stranger)", asAdmin[0]?.is_admin === false);
}

async function readOnlyChecks() {
  const tables = (await admin`select tablename from pg_tables where schemaname = 'public' order by 1`).map((r) => r.tablename as string);
  for (const p of [
    { label: "anon", key: anonKey!, bearer: anonKey! },
    { label: "service_role", key: serviceKey!, bearer: serviceKey! },
  ]) {
    console.log(`\n--- B (read-only). Data API as ${p.label} ---`);
    const readable: string[] = [];
    for (const t of tables) {
      const res = await fetch(`${supabaseUrl}/rest/v1/${t}?select=*&limit=0`, {
        headers: { apikey: p.key, Authorization: `Bearer ${p.bearer}`, Prefer: "count=exact" },
      });
      await res.text();
      if (res.status < 400) readable.push(`${t}:${res.headers.get("content-range") ?? res.status}`);
    }
    check(`B1. ${p.label}: no public table is readable (${tables.length} tables)`, readable.length === 0, readable);
    const rpc = await fetch(`${supabaseUrl}/rest/v1/rpc/app_is_admin`, {
      method: "POST",
      headers: { apikey: p.key, Authorization: `Bearer ${p.bearer}`, "Content-Type": "application/json" },
      body: "{}",
    });
    await rpc.text();
    check(`B9. ${p.label}: app_is_admin() is not callable over RPC`, rpc.status >= 400, rpc.status);
  }
  console.log("\n--- C (read-only). app_runtime ---");
  const qr = await runtime.begin(async (tx) => tx`select count(*)::int as n from qr_codes`);
  check("C1. app_runtime can still read qr_codes", typeof qr[0]?.n === "number");
  const admins = await runtime.begin(async (tx) => tx`select id from admin_users`);
  check("C3. RLS still applies to app_runtime with no actor context (admin_users hidden)", admins.length === 0);
  const asAdmin = await runtime.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${crypto.randomUUID()}, true)`;
    return tx`select app_is_admin() as is_admin`;
  });
  check("C5. RLS helper functions still execute", asAdmin[0]?.is_admin === false);
}

async function main() {
  if (process.env.LOCKDOWN_READ_ONLY === "1") {
    try {
      await catalogChecks();
      await readOnlyChecks();
    } finally {
      await admin.end();
      await runtime.end();
    }
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  }

  let fixtures: Fixtures | null = null;
  let authUserId: string | null = null;
  try {
    await catalogChecks();

    fixtures = await createFixtures();
    const service = createClient(supabaseUrl!, serviceKey!, { auth: { persistSession: false } });
    const email = `lockdown-${marker.toLowerCase()}@dev.local`;
    const password = `ld-${crypto.randomUUID()}`;
    const { data: created, error: createError } = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (createError || !created.user) throw createError ?? new Error("could not create verify user");
    authUserId = created.user.id;
    // A real partner member, so this also covers "signed-in partner via the API".
    await admin`insert into partner_members (partner_id, user_id, role) values (${fixtures.partnerId}, ${authUserId}, 'OWNER')`;
    const userClient = createClient(supabaseUrl!, anonKey!, { auth: { persistSession: false } });
    const { data: session, error: signInError } = await userClient.auth.signInWithPassword({ email, password });
    if (signInError || !session.session) throw signInError ?? new Error("could not sign in verify user");

    await httpChecks(fixtures, [
      { label: "anon", key: anonKey!, bearer: anonKey! },
      { label: "authenticated partner", key: anonKey!, bearer: session.session.access_token },
      { label: "service_role", key: serviceKey!, bearer: serviceKey! },
    ]);
    await runtimeChecks(fixtures);

    await admin`delete from partner_members where user_id = ${authUserId}`;
  } finally {
    await cleanup(fixtures, authUserId);
    await admin.end();
    await runtime.end();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
