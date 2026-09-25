import { createClient } from "@supabase/supabase-js";

/**
 * Verifies the password-reset flow's security invariants directly against
 * the local Supabase Auth server (GoTrue) — no mocks, same philosophy as the
 * other verify-*.ts scripts. Deliberately tests at the Supabase Auth API
 * layer (generateLink/verifyOtp) rather than through the Next.js
 * /auth/confirm route handler's PKCE code exchange, which is a browser
 * concern covered by the Playwright suite instead (see AGENTS/plan notes).
 *
 * Does NOT test real link *expiry* (otp_expiry is a real 3600s in
 * supabase/config.toml — waiting that out is not something a fast CI check
 * should do); that remains a manual/staging verification item.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required");
}

const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

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

async function main() {
  console.log("Setting up fixtures (service role)...");
  const email = `pw-reset-${crypto.randomUUID()}@example.test`;
  const originalPassword = "original-password-123";
  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password: originalPassword,
    email_confirm: true,
  });
  if (createError || !created.user) throw new Error(`Failed to create fixture user: ${createError?.message}`);

  console.log("\n--- No account enumeration through reset-request responses ---");
  {
    const anon = createClient(supabaseUrl!, anonKey!, { auth: { persistSession: false } });
    const realEmailResult = await anon.auth.resetPasswordForEmail(email);
    const nonexistentResult = await anon.auth.resetPasswordForEmail(`nobody-${crypto.randomUUID()}@example.test`);
    check("1. Reset request for a REAL email does not error", realEmailResult.error === null);
    check("2. Reset request for a NONEXISTENT email does not error either — same response shape", nonexistentResult.error === null);
  }

  console.log("\n--- Invalid reset token is rejected ---");
  {
    const anon = createClient(supabaseUrl!, anonKey!, { auth: { persistSession: false } });
    const { error } = await anon.auth.verifyOtp({ email, token: "000000-not-a-real-token", type: "recovery" });
    check("3. A garbage/invalid recovery token is rejected, not silently accepted", error !== null);
  }

  console.log("\n--- A real recovery link/token establishes a session and allows a password change ---");
  {
    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({ type: "recovery", email });
    if (linkError || !linkData) throw new Error(`generateLink failed: ${linkError?.message}`);
    const otp = (linkData.properties as { email_otp?: string } | undefined)?.email_otp;
    if (!otp) throw new Error("generateLink did not return an email_otp to verify against");

    const anon = createClient(supabaseUrl!, anonKey!, { auth: { persistSession: false } });
    const { data: verifyData, error: verifyError } = await anon.auth.verifyOtp({ email, token: otp, type: "recovery" });
    check("4. A genuine recovery token is accepted and establishes a session", verifyError === null && !!verifyData.session);

    const newPassword = "brand-new-password-456";
    const { error: updateError } = await anon.auth.updateUser({ password: newPassword });
    check("5. updateUser succeeds once a recovery session is established", updateError === null);

    const signInWithNew = await anon.auth.signInWithPassword({ email, password: newPassword });
    check("6. Signing in with the NEW password succeeds", signInWithNew.error === null);

    const signInWithOld = await createClient(supabaseUrl!, anonKey!, { auth: { persistSession: false } }).auth.signInWithPassword({
      email,
      password: originalPassword,
    });
    check("7. Signing in with the OLD password no longer works", signInWithOld.error !== null);
  }

  console.log("\n--- The same recovery token cannot be replayed ---");
  {
    const { data: linkData } = await adminClient.auth.admin.generateLink({ type: "recovery", email });
    const otp = (linkData?.properties as { email_otp?: string } | undefined)?.email_otp;
    if (otp) {
      const anon = createClient(supabaseUrl!, anonKey!, { auth: { persistSession: false } });
      await anon.auth.verifyOtp({ email, token: otp, type: "recovery" });
      const replay = await createClient(supabaseUrl!, anonKey!, { auth: { persistSession: false } }).auth.verifyOtp({ email, token: otp, type: "recovery" });
      check("8. A one-time recovery token cannot be verified a second time", replay.error !== null);
    } else {
      check("8. A one-time recovery token cannot be verified a second time", false, "no OTP returned to test replay with");
    }
  }

  console.log("\nCleaning up fixtures...");
  await adminClient.auth.admin.deleteUser(created.user.id);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
