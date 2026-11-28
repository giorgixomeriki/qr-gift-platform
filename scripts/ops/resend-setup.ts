import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * One-time Resend setup for partner email (docs/partner-auth/EMAIL-RELEASE.md).
 * Uses a temporary FULL-access key that the owner saved to a 0600 file; prints
 * no key, ever.
 *
 *   npx tsx scripts/ops/resend-setup.ts records      add qrapp.ge (eu-west-1) if missing, print DNS records
 *   npx tsx scripts/ops/resend-setup.ts verify       ask Resend to re-check DNS, print status per record
 *   npx tsx scripts/ops/resend-setup.ts sending-key  domain must be verified: create the app's sending-only key
 *                                                    "qrapp-render" into RESEND_KEY_OUT (never overwritten)
 *   npx tsx scripts/ops/resend-setup.ts smtp-key     same, key "qrapp-supabase-smtp" for Supabase Auth custom SMTP
 *                                                    into ~/.qrapp-review/resend-smtp-key (separately revocable)
 *
 * Env: RESEND_SETUP_KEY_FILE (default ~/.qrapp-review/resend-setup-key),
 *      RESEND_KEY_OUT (default ~/.qrapp-review/resend-api-key), RESEND_DOMAIN (default qrapp.ge).
 * Afterwards the owner deletes the setup key in the Resend dashboard.
 */
const DOMAIN = process.env.RESEND_DOMAIN ?? "qrapp.ge";
const REGION = "eu-west-1";
const SETUP_KEY_FILE = process.env.RESEND_SETUP_KEY_FILE ?? join(homedir(), ".qrapp-review", "resend-setup-key");
const KEY_OUT = process.env.RESEND_KEY_OUT ?? join(homedir(), ".qrapp-review", "resend-api-key");
const SMTP_KEY_OUT = join(homedir(), ".qrapp-review", "resend-smtp-key");

type DnsRecord = { record: string; name: string; type: string; value: string; priority?: number; ttl?: string; status?: string };
type Domain = { id: string; name: string; status: string; region: string; records?: DnsRecord[]; open_tracking?: boolean; click_tracking?: boolean };

function setupKey(): string {
  if (!existsSync(SETUP_KEY_FILE)) throw new Error(`setup key file not found: ${SETUP_KEY_FILE}`);
  const key = readFileSync(SETUP_KEY_FILE, "utf8").trim();
  if (!/^re_[A-Za-z0-9_]{10,}$/.test(key)) throw new Error("setup key file does not hold a Resend key (re_…)");
  return key;
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.resend.com${path}`, {
    method,
    headers: { Authorization: "Bearer " + setupKey(), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    // Resend error bodies carry name/message only; never echo request headers.
    let msg = text.slice(0, 300);
    try {
      const j = JSON.parse(text) as { name?: string; message?: string };
      msg = `${j.name ?? ""} ${j.message ?? ""}`.trim();
    } catch {}
    throw new Error(`${method} ${path} → HTTP ${res.status}: ${msg}`);
  }
  await new Promise((r) => setTimeout(r, 600)); // Resend default limit: 2 req/s
  return (text ? JSON.parse(text) : {}) as T;
}

async function findOrCreateDomain(create: boolean): Promise<Domain> {
  const list = await api<{ data: Domain[] }>("GET", "/domains");
  const found = list.data.find((d) => d.name === DOMAIN);
  if (found) return api<Domain>("GET", `/domains/${found.id}`);
  if (!create) throw new Error(`${DOMAIN} is not added in Resend yet; run "records" first`);
  const created = await api<Domain>("POST", "/domains", { name: DOMAIN, region: REGION });
  console.log(`Added ${DOMAIN} to Resend (region ${REGION}).`);
  return api<Domain>("GET", `/domains/${created.id}`);
}

/** Auth links are single-use secrets: Resend must not rewrite or pixel-track them. */
async function trackingOff(d: Domain) {
  if (d.open_tracking === false && d.click_tracking === false) return;
  await api("PATCH", `/domains/${d.id}`, { open_tracking: false, click_tracking: false });
  console.log("Open and click tracking turned OFF for the domain (activation links stay unmodified).");
}

function printRecords(d: Domain) {
  console.log(`\nDomain ${d.name}  status=${d.status}  region=${d.region}`);
  console.log("Route 53 → Hosted zones → qrapp.ge → Create record (TTL 300):\n");
  for (const r of d.records ?? []) {
    const fqdn = r.name === "@" || r.name === "" ? DOMAIN : `${r.name}.${DOMAIN}`;
    const value = r.type === "TXT" ? `"${r.value}"` : r.type === "MX" ? `${r.priority ?? 10} ${r.value}` : r.value;
    console.log(`  [${r.status ?? "?"}] ${r.record.padEnd(5)} ${r.type.padEnd(3)}  ${fqdn}\n        ${value}\n`);
  }
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === "records") {
    const d = await findOrCreateDomain(true);
    await trackingOff(d);
    printRecords(await findOrCreateDomain(false));
  } else if (cmd === "verify") {
    const d = await findOrCreateDomain(false);
    await api("POST", `/domains/${d.id}/verify`);
    await new Promise((r) => setTimeout(r, 5000));
    printRecords(await findOrCreateDomain(false));
  } else if (cmd === "sending-key" || cmd === "smtp-key") {
    const [name, out] = cmd === "sending-key" ? ["qrapp-render", KEY_OUT] : ["qrapp-supabase-smtp", SMTP_KEY_OUT];
    const d = await findOrCreateDomain(false);
    if (d.status !== "verified") throw new Error(`domain status is "${d.status}", not "verified"; no key created`);
    if (existsSync(out)) throw new Error(`${out} already exists; refusing to overwrite`);
    const k = await api<{ id: string; token: string }>("POST", "/api-keys", { name, permission: "sending_access", domain_id: d.id });
    writeFileSync(out, k.token + "\n", { mode: 0o600, flag: "wx" });
    console.log(`Sending-only key "${name}" (id ${k.id}) restricted to ${DOMAIN} saved to ${out} (0600). Value not printed.`);
  } else {
    console.log("usage: resend-setup.ts records | verify | sending-key | smtp-key");
    process.exit(2);
  }
}

main().catch((e: Error) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
