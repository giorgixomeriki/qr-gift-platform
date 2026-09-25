import Module from "node:module";

// Same server-only shim as the other verify-*.ts scripts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ModuleInternals = Module as any;
const nodeModuleLoad = ModuleInternals._load;
ModuleInternals._load = function (request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  return nodeModuleLoad.call(this, request, ...rest);
};

const { createClient } = require("@supabase/supabase-js") as typeof import("@supabase/supabase-js");
const { resolveOrInviteUserByEmail } = require("../src/lib/auth/admin-users") as typeof import("../src/lib/auth/admin-users");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** A small page size (5) forces real pagination with only ~12 fixture users, instead of needing 50+. */
const TEST_PAGE_SIZE = 5;

async function main() {
  console.log("Setting up fixtures (service role) — creating enough users to force multiple pages...");
  const createdIds: string[] = [];
  const runId = crypto.randomUUID().slice(0, 8);

  // 12 filler users + 1 "target" user we expect to land past page 1 at
  // TEST_PAGE_SIZE=5 (target created last, so it's likely on page 3).
  for (let i = 0; i < 12; i++) {
    const { data, error } = await admin.auth.admin.createUser({ email: `pagination-filler-${runId}-${i}@example.test`, email_confirm: true });
    if (error || !data.user) throw new Error(`Failed to create filler user ${i}: ${error?.message}`);
    createdIds.push(data.user.id);
  }
  const targetEmail = `pagination-target-${runId}@example.test`;
  const { data: targetData, error: targetError } = await admin.auth.admin.createUser({ email: targetEmail, email_confirm: true });
  if (targetError || !targetData.user) throw new Error(`Failed to create target user: ${targetError?.message}`);
  createdIds.push(targetData.user.id);

  try {
    console.log("\n--- A user beyond page 1 is still found, not re-invited ---");
    const result = await resolveOrInviteUserByEmail(targetEmail, TEST_PAGE_SIZE);
    check("1. An existing user placed past page 1 is found by id", result.userId === targetData.user.id);
    check("2. That existing user is resolved, not (re-)invited", result.invited === false);

    console.log("\n--- A genuinely nonexistent email is still invited (unchanged behavior) ---");
    const newEmail = `pagination-new-${runId}@example.test`;
    const inviteResult = await resolveOrInviteUserByEmail(newEmail, TEST_PAGE_SIZE);
    check("3. A nonexistent email is invited (a brand-new account is created)", inviteResult.invited === true);
    createdIds.push(inviteResult.userId);

    console.log("\n--- Case-insensitive email matching still works across pages ---");
    const caseResult = await resolveOrInviteUserByEmail(targetEmail.toUpperCase(), TEST_PAGE_SIZE);
    check("4. The same user is found regardless of email casing", caseResult.userId === targetData.user.id && caseResult.invited === false);
  } finally {
    console.log("\nCleaning up fixtures...");
    for (const id of createdIds) {
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
