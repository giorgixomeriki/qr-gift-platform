import { resolveMx, resolveTxt } from "node:dns/promises";

/**
 * Release gate for partner email links (docs/partner-auth/EMAIL-RELEASE.md).
 * Checks, without printing any secret: the Resend key's shape, the sender,
 * the domain's Resend DNS records (DKIM + SPF on the send. subdomain), and
 * optionally sends one real test email.
 *
 *   RESEND_API_KEY=... PARTNER_EMAIL_FROM="QR STARR <partners@qrapp.ge>" \
 *     npx tsx scripts/check-partner-email.ts [--send-to you@example.com]
 *
 * Exit 0 only when every check passes.
 */
const key = process.env.RESEND_API_KEY ?? "";
const from = process.env.PARTNER_EMAIL_FROM ?? "";
const sendTo = (() => {
  const i = process.argv.indexOf("--send-to");
  return i > 0 ? process.argv[i + 1] : undefined;
})();

let failures = 0;
function report(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function txt(name: string): Promise<string[]> {
  try {
    return (await resolveTxt(name)).map((parts) => parts.join(""));
  } catch {
    return [];
  }
}

async function main() {
  report("RESEND_API_KEY present and shaped like a Resend key (re_…)", /^re_[A-Za-z0-9_]{10,}$/.test(key), key ? `length ${key.length}` : "unset");
  const domain = /@([a-z0-9.-]+\.[a-z]{2,})>?\s*$/i.exec(from)?.[1]?.toLowerCase();
  report("PARTNER_EMAIL_FROM has a sender address", Boolean(domain), from || "unset");
  if (!domain) return;

  const dkim = await txt(`resend._domainkey.${domain}`);
  report(`DKIM TXT resend._domainkey.${domain}`, dkim.some((v) => /p=/.test(v)), dkim.length ? "found" : "missing");
  let mx: { exchange: string }[] = [];
  try {
    mx = await resolveMx(`send.${domain}`);
  } catch {
    mx = [];
  }
  report(`SPF MX send.${domain} -> feedback-smtp.*.amazonses.com`, mx.some((r) => /amazonses\.com$/i.test(r.exchange)), mx.map((r) => r.exchange).join(", ") || "missing");
  const spf = await txt(`send.${domain}`);
  report(`SPF TXT send.${domain} includes amazonses.com`, spf.some((v) => /v=spf1/.test(v) && /include:amazonses\.com/.test(v)), spf.length ? "found" : "missing");
  const dmarc = await txt(`_dmarc.${domain}`);
  console.log(`  INFO  DMARC _dmarc.${domain}: ${dmarc.some((v) => /^v=DMARC1/.test(v)) ? "present" : "absent (recommended, not required)"}`);

  if (sendTo && failures === 0) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [sendTo], subject: "QR STARR — email delivery check", text: "Partner email delivery works. No action needed." }),
    });
    report(`test email accepted by Resend (to ${sendTo.replace(/^(.).*@/, "$1•••@")})`, res.ok, `HTTP ${res.status}`);
  }
}

main().finally(() => {
  console.log(failures === 0 ? "\nREADY" : `\nNOT READY (${failures} failing)`);
  process.exit(failures === 0 ? 0 : 1);
});
