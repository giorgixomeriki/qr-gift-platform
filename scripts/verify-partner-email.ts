import Module from "node:module";
import { randomUUID } from "node:crypto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ModuleInternals = Module as any;
const nodeModuleLoad = ModuleInternals._load;
ModuleInternals._load = function (request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  return nodeModuleLoad.call(this, request, ...rest);
};

/**
 * The production email path for partner links: the Resend transport
 * (lib/notify/email.ts) and the activation email (lib/partners/login-email.ts),
 * with Resend's HTTP API stood in by a fetch stub. Proves what is sent, that a
 * provider failure rolls the invitation back (no "sent" link that never
 * arrived), and that nothing secret is logged.
 */
process.env.PARTNER_EMAIL_TRANSPORT = "resend";
process.env.RESEND_API_KEY = "re_test_0000000000000000000000";
process.env.PARTNER_EMAIL_FROM = "QR STARR <partners@qrapp.ge>";
delete process.env.PARTNER_EMAIL_LOG_FILE;

const postgres = require("postgres") as typeof import("postgres");
const { sendEmail, EmailSendError, emailDeliveryConfigured } = require("../src/lib/notify/email") as typeof import("../src/lib/notify/email");
const { sendPartnerLinkEmail } = require("../src/lib/partners/login-email") as typeof import("../src/lib/partners/login-email");
const access = require("../src/lib/partners/login-access") as typeof import("../src/lib/partners/login-access");
const { createSupabaseAuthDirectory } = require("../src/lib/auth/auth-directory") as typeof import("../src/lib/auth/auth-directory");
const { withAdminContext } = require("../src/db/client") as typeof import("../src/db/client");
const { partnerAuthConfigProblems } = require("../src/lib/env-guards") as typeof import("../src/lib/env-guards");

const admin = postgres(process.env.MIGRATIONS_DATABASE_URL!, { max: 1 });
let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
}

type Captured = { url: string; init: RequestInit };
const captured: Captured[] = [];
let respond: () => Promise<Response> = async () => new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  if (String(url).startsWith("https://api.resend.com/")) {
    captured.push({ url: String(url), init: init ?? {} });
    return respond();
  }
  return realFetch(url, init);
}) as typeof fetch;

const logged: string[] = [];
for (const level of ["log", "info", "warn", "error"] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
    if (level === "log") original(...args);
  };
}

async function main() {
  console.log("--- Resend transport ---");
  check("1. resend transport counts as configured", emailDeliveryConfigured());
  const expiresAt = new Date(Date.now() + 72 * 3600_000);
  const link = `https://qrapp.ge/partner/activate?token=${"T".repeat(43)}`;
  await sendPartnerLinkEmail({ to: "shop@example.ge", partnerName: `<script>alert(1)</script> & Co`, link, purpose: "ACTIVATION", expiresAt, invitationId: "inv-1" });
  const req = captured.at(-1)!;
  const headers = new Headers(req.init.headers);
  const body = JSON.parse(String(req.init.body)) as { from: string; to: string[]; subject: string; text: string; html: string };
  check("2. POST https://api.resend.com/emails", req.url === "https://api.resend.com/emails" && req.init.method === "POST");
  check("3. Bearer key + idempotency key per invitation", headers.get("authorization") === "Bearer re_test_0000000000000000000000" && headers.get("idempotency-key") === "partner-link-inv-1");
  check("4. from = configured sender, to = the partner only", body.from === "QR STARR <partners@qrapp.ge>" && body.to.length === 1 && body.to[0] === "shop@example.ge");
  check("5. bilingual subject; link in text and html", /გააქტიურება/.test(body.subject) && /Activate/.test(body.subject) && body.text.includes(link) && body.html.includes(link));
  check("6. partner name is HTML-escaped", !body.html.includes("<script>") && body.html.includes("&lt;script&gt;"));
  check("7. expiry stated in Tbilisi time", /Tbilisi/.test(body.text));

  respond = async () => new Response(JSON.stringify({ message: "domain not verified: shop@example.ge" }), { status: 403 });
  let err: unknown = null;
  try {
    await sendEmail({ to: "x@example.ge", subject: "s", text: "t", html: "h", idempotencyKey: "k" });
  } catch (e) {
    err = e;
  }
  check("8. provider refusal -> EmailSendError with status only", err instanceof EmailSendError && /HTTP 403/.test((err as Error).message) && !/example\.ge/.test((err as Error).message));
  respond = async () => {
    throw new TypeError("fetch failed");
  };
  err = null;
  try {
    await sendEmail({ to: "x@example.ge", subject: "s", text: "t", html: "h", idempotencyKey: "k" });
  } catch (e) {
    err = e;
  }
  check("9. network failure -> EmailSendError", err instanceof EmailSendError);

  console.log("\n--- Invitation is not recorded when the email fails ---");
  const adminUserId = randomUUID();
  await admin`insert into admin_users (user_id) values (${adminUserId})`;
  const partnerId = randomUUID();
  const email = `pe-${partnerId.slice(0, 8)}@verify.test`;
  await admin`insert into partners (id, slug, name, contact_email) values (${partnerId}, ${`pe-${partnerId.slice(0, 8)}`}, 'Email Verify', ${email})`;
  const deps = {
    directory: createSupabaseAuthDirectory(),
    sendLinkEmail: sendPartnerLinkEmail,
    emailConfigured: true,
    phoneEnabled: false,
    appUrl: "https://qrapp.ge",
    ttlHours: 72,
  };
  respond = async () => new Response("{}", { status: 500 });
  const failedIssue = await withAdminContext(adminUserId, (tx) => access.issueActivation(tx, adminUserId, partnerId, "EMAIL", deps)).then(
    () => "OK",
    (e: Error) => e.name,
  );
  const rows = await admin`select count(*)::int as n from partner_invitations where partner_id = ${partnerId}`;
  const audits = await admin`select count(*)::int as n from audit_logs where target_id = ${partnerId}`;
  check("10. send failure -> action fails, no invitation, no audit row", failedIssue === "EmailSendError" && rows[0]!.n === 0 && audits[0]!.n === 0, { failedIssue, rows: rows[0], audits: audits[0] });
  respond = async () => new Response(JSON.stringify({ id: "email_2" }), { status: 200 });
  const ok = await withAdminContext(adminUserId, (tx) => access.issueActivation(tx, adminUserId, partnerId, "EMAIL", deps));
  const sentBody = JSON.parse(String(captured.at(-1)!.init.body)) as { text: string };
  const token = /token=([A-Za-z0-9_-]{43})/.exec(sentBody.text)?.[1] ?? "";
  const stored = await admin`select token_hash, status from partner_invitations where id = ${ok.invitationId}`;
  check("11. success -> pending invitation whose hash matches the emailed token", stored[0]?.status === "PENDING" && stored[0]?.token_hash === access.hashActivationToken(token));
  check("12. phone channel refused in email-only mode", (await withAdminContext(adminUserId, (tx) => access.issueActivation(tx, adminUserId, partnerId, "PHONE", deps)).then(() => "OK", (e: { code?: string }) => e.code ?? "x")) === "phone_auth_disabled");
  check("13. email-only mode: a phone-only partner is refused", (() => { try { access.parseContacts({ phone: "555123456" }, { requireEmail: true }); return false; } catch (e) { return (e as { code?: string }).code === "email_required"; } })());

  console.log("\n--- Every link email shows the link (initial, resend, reset; ka + en) ---");
  type Sent = { subject: string; text: string; html: string; headers?: Record<string, string> };
  const bodyAt = (i: number) => JSON.parse(String(captured.at(i)!.init.body)) as Sent;
  const linkRe = /https:\/\/qrapp\.ge\/partner\/activate\?token=([A-Za-z0-9_-]{43})/g;
  function linkShown(b: Sent): { ok: boolean; token: string } {
    const inText = [...b.text.matchAll(linkRe)].map((m) => m[1]);
    const hrefs = [...b.html.matchAll(/href="(https:\/\/qrapp\.ge\/partner\/activate\?token=([A-Za-z0-9_-]{43}))"/g)].map((m) => m[2]);
    const visibleUrl = />https:\/\/qrapp\.ge\/partner\/activate\?token=[A-Za-z0-9_-]{43}</.test(b.html);
    const token = inText[0] ?? "";
    // Link first: before the Georgian and English explanations, in both parts.
    const textFirst = b.text.indexOf(token) < b.text.indexOf("QR STARR") || b.text.indexOf(token) < b.text.search(/გამარჯობა|„/);
    const htmlFirst = b.html.indexOf("href=") < b.html.search(/გამარჯობა|„/) && b.html.indexOf("href=") < b.html.search(/Hello!|A password reset/);
    const ok = inText.length === 1 && hrefs.length === 2 && hrefs.every((h) => h === token) && visibleUrl && textFirst && htmlFirst;
    return { ok, token };
  }
  const p2 = randomUUID();
  const email2 = `pr-${p2.slice(0, 8)}@verify.test`;
  await admin`insert into partners (id, slug, name, contact_email) values (${p2}, ${`pr-${p2.slice(0, 8)}`}, 'TST Flw', ${email2})`;
  const before = captured.length;
  const first = await withAdminContext(adminUserId, (tx) => access.issueActivation(tx, adminUserId, p2, "EMAIL", deps));
  await new Promise((r) => setTimeout(r, 61_000 - (Date.now() % 60_000) + 50)); // next minute: distinct expiry in the subject
  const second = await withAdminContext(adminUserId, (tx) => access.issueActivation(tx, adminUserId, p2, "EMAIL", deps));
  const e1 = bodyAt(-2);
  const e2 = bodyAt(-1);
  const s1 = linkShown(e1);
  const s2 = linkShown(e2);
  check("18. initial invitation: link in text + clickable button + visible URL, before the explanation", captured.length === before + 2 && s1.ok, e1.text.slice(0, 80));
  check("19. resend: link in text + clickable button + visible URL, before the explanation", s2.ok, e2.text.slice(0, 80));
  check("20. resend gets a new single-use token (not the first one)", s1.token !== s2.token && s2.token.length === 43);
  check("21. resend subject differs (mail apps don't merge and trim it) and is still bilingual", e1.subject !== e2.subject && /გააქტიურება/.test(e2.subject) && /Activate/.test(e2.subject));
  check("22. each email has its own X-Entity-Ref-ID = invitation id", e1.headers?.["X-Entity-Ref-ID"] === first.invitationId && e2.headers?.["X-Entity-Ref-ID"] === second.invitationId);
  const hours = (second.expiresAt.getTime() - Date.now()) / 3600_000;
  check("23. resend expiry = 72 hours, stated in ka and en", hours > 71.9 && hours <= 72 && /მოქმედებს .*-მდე/.test(e2.text) && /expires .* \(Tbilisi time\)/.test(e2.text));
  const inv = await admin`select id, status, token_hash from partner_invitations where partner_id = ${p2} order by created_at`;
  check("24. first invitation revoked (REISSUED), only the resend is pending; hash of emailed token stored", inv.length === 2 && inv[0]!.status === "REVOKED" && inv[1]!.status === "PENDING" && inv[1]!.token_hash === access.hashActivationToken(s2.token), inv.map((r) => r.status));
  check("25. old link -> invalid, resent link -> valid", (await access.previewLink(s1.token)).state === "invalid" && (await access.previewLink(s2.token)).state === "valid");
  await admin`update partner_invitations set created_at = now() - interval '73 hours', expires_at = now() - interval '1 hour' where id = ${second.invitationId}`;
  check("26. resent link past 72h -> expired", (await access.previewLink(s2.token)).state === "expired");
  await admin`update partner_invitations set expires_at = now() + interval '1 hour', status = 'ACCEPTED', accepted_user_id = ${randomUUID()}, accepted_at = now() where id = ${second.invitationId}`;
  check("27. used resent link -> used", (await access.previewLink(s2.token)).state === "used");
  const rec = (await import("../src/lib/partners/login-email")).buildPartnerLinkEmail({ to: email2, partnerName: "TST Flw", link: `https://qrapp.ge/partner/activate?token=${"R".repeat(43)}`, purpose: "RECOVERY", expiresAt: new Date(Date.now() + 24 * 3600_000), invitationId: "inv-r" });
  check("28. reset email shows the link the same way (ka + en)", linkShown(rec).ok && /პაროლის/.test(rec.subject) && /Reset/.test(rec.subject));
  check("29. no resend token in any log line", logged.every((l) => !l.includes(s1.token) && !l.includes(s2.token)));
  await admin`delete from audit_logs where target_id = ${p2}`;
  await admin`delete from partner_invitations where partner_id = ${p2}`;
  await admin`delete from partners where id = ${p2}`;

  check("14. no token, API key or link body in any log line", logged.every((l) => !l.includes(token) && !l.includes("re_test_") && !l.includes("partner/activate?token=")), logged.filter((l) => l.includes("token")));

  console.log("\n--- Production configuration guard ---");
  check("15. hosted + resend without key/sender refused", partnerAuthConfigProblems({ hosted: true, emailTransport: "resend", phoneEnabled: false }).length === 2);
  check("16. hosted + log transport refused", partnerAuthConfigProblems({ hosted: true, emailTransport: "log", resendApiKey: "re_x", emailFrom: "a@b.c", phoneEnabled: false }).length === 1);
  check("17. hosted + resend complete + phone off accepted", partnerAuthConfigProblems({ hosted: true, emailTransport: "resend", resendApiKey: "re_x", emailFrom: "QR STARR <partners@qrapp.ge>", phoneEnabled: false }).length === 0);

  await admin`delete from audit_logs where target_id = ${partnerId}`;
  await admin`delete from partner_invitations where partner_id = ${partnerId}`;
  await admin`delete from partners where id = ${partnerId}`;
  await admin`delete from admin_users where user_id = ${adminUserId}`;
  console.log(`\n${passed} passed, ${failed} failed`);
}

main()
  .catch((e) => {
    failed++;
    console.error(e);
  })
  .finally(async () => {
    await admin.end();
    process.exit(failed > 0 ? 1 : 0);
  });
