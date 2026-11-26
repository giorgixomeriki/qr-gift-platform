/**
 * The purchase confirmation as one self-contained HTML file (no scripts, no
 * external resources) that a phone can save and a browser can print or save
 * as PDF. Pure, so verify:purchase-confirmation can call it.
 */
export type ConfirmationData = {
  orderId: string;
  orderStatus: string;
  amountMinor: number;
  currency: string;
  paidAt: Date;
  activatedAt: Date;
  availableUntil: Date;
  unlockAt: Date | null;
  unlockTimeZone: string | null;
  consent: {
    acceptedAt: Date;
    locale: "ka" | "en";
    policiesEffectiveDate: string | null;
    sha256: string;
    statements: [string, string] | string[] | null;
  } | null;
  seller: { name: string; idCode: string | null; legalAddress: string | null; supportEmail: string | null } | null;
};

const L = {
  ka: {
    title: "გადახდისა და ხელშეკრულების დადასტურება",
    intro: "ეს დოკუმენტი ადასტურებს QR Starr-ის ციფრული მილოცვის გააქტიურების საფასურის გადახდას და იმ პირობებს, რომლებსაც გადახდისას დაეთანხმეთ. შეინახეთ იგი.",
    seller: "გამყიდველი",
    idCode: "საიდენტიფიკაციო კოდი",
    address: "იურიდიული მისამართი",
    support: "კონტაქტი",
    order: "შეკვეთის ნომერი",
    service: "მომსახურება",
    serviceValue: "ციფრული მილოცვის გააქტიურება QR Starr-ის ბარათზე",
    amount: "გადახდილი თანხა",
    paidAt: "გადახდის დრო",
    activatedAt: "გააქტიურების დრო (მიწოდების დაწყება)",
    opensAt: "ადრესატისთვის გახსნის დრო",
    opensNow: "გააქტიურებისთანავე",
    availableUntil: "ბარათზე ხელმისაწვდომია",
    statusRefunded: "სტატუსი: თანხა დაბრუნებულია",
    legal: "მოქმედი პირობები",
    legalValue: (d: string | null) => (d ? `წესები და პირობები, კონფიდენციალურობის პოლიტიკა, მიწოდებისა და თანხის დაბრუნების პოლიტიკა — ძალაშია ${d}-დან` : "წესები და პირობები, კონფიდენციალურობის პოლიტიკა, მიწოდებისა და თანხის დაბრუნების პოლიტიკა"),
    consents: "გადახდამდე მონიშნული თანხმობები",
    consentAt: "თანხმობის დრო",
    noStatements: "თანხმობა ჩაწერილია, თუმცა მისი ტექსტი მიმდინარე ვერსიისგან განსხვავდება; ტექსტის ანაბეჭდი (SHA-256):",
    noConsent: "ამ შეკვეთისთვის თანხმობის ჩანაწერი ვერ მოიძებნა.",
    withdrawal: "ციფრული შინაარსი არამყარი მატარებლით მოგეწოდათ: ხელშეკრულების შესრულება გააქტიურებისთანავე დაიწყო თქვენი წინასწარი თანხმობით, და იცოდით, რომ ამით კარგავდით ხელშეკრულებაზე უარის თქმის უფლებას. თანხის დაბრუნების შემთხვევები და თქვენი კანონიერი უფლებები აღწერილია მიწოდებისა და თანხის დაბრუნების პოლიტიკაში.",
    links: "პირობები: qrapp.ge/terms · qrapp.ge/privacy · qrapp.ge/delivery-and-refunds",
    tz: "თბილისის დრო",
    footer: "დოკუმენტი შექმნილია qrapp.ge-ზე",
  },
  en: {
    title: "Payment and contract confirmation",
    intro: "This document confirms your payment of the activation fee for a QR Starr digital greeting and the terms you accepted when paying. Please keep it.",
    seller: "Seller",
    idCode: "Identification code",
    address: "Legal address",
    support: "Contact",
    order: "Order reference",
    service: "Service",
    serviceValue: "Activation of a digital greeting on a QR Starr card",
    amount: "Amount paid",
    paidAt: "Paid at",
    activatedAt: "Activated at (supply started)",
    opensAt: "Opens for the recipient at",
    opensNow: "On activation",
    availableUntil: "Available on the card until",
    statusRefunded: "Status: refunded",
    legal: "Terms that apply",
    legalValue: (d: string | null) => (d ? `Terms and Conditions, Privacy Policy, Delivery and Refunds policy — in effect from ${d}` : "Terms and Conditions, Privacy Policy, Delivery and Refunds policy"),
    consents: "Consents ticked before payment",
    consentAt: "Consent given at",
    noStatements: "Consent is recorded, but its wording differs from the current version; fingerprint of the accepted text (SHA-256):",
    noConsent: "No consent record was found for this order.",
    withdrawal: "Supply of the digital content started on activation with your prior consent, so the right of withdrawal no longer applies. When you can get a refund, and your rights under the law, are set out in the Delivery and Refunds policy.",
    links: "Terms: qrapp.ge/terms · qrapp.ge/privacy · qrapp.ge/delivery-and-refunds",
    tz: "Tbilisi time",
    footer: "Generated on qrapp.ge",
  },
} as const;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function when(d: Date, locale: "ka" | "en", tz = "Asia/Tbilisi"): string {
  return new Intl.DateTimeFormat(locale === "ka" ? "ka-GE" : "en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

function money(minor: number, currency: string): string {
  return `${(minor / 100).toFixed(2)} ${currency === "GEL" ? "GEL (₾)" : currency}`;
}

/** Short, human-quotable form of the order id (the full id is printed too). */
export function orderReference(orderId: string): string {
  return orderId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

export function confirmationFileName(orderId: string): string {
  return `qr-starr-confirmation-${orderReference(orderId)}.html`;
}

export function renderConfirmationHtml(d: ConfirmationData, now: Date = new Date()): string {
  const locale = d.consent?.locale ?? "ka";
  const t = L[locale];
  const row = (k: string, v: string) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
  const rows = [
    d.seller ? row(t.seller, esc(d.seller.name)) : "",
    d.seller?.idCode ? row(t.idCode, esc(d.seller.idCode)) : "",
    d.seller?.legalAddress ? row(t.address, esc(d.seller.legalAddress)) : "",
    d.seller?.supportEmail ? row(t.support, esc(d.seller.supportEmail)) : "",
    row(t.order, `<strong>${esc(orderReference(d.orderId))}</strong><br><small>${esc(d.orderId)}</small>`),
    row(t.service, esc(t.serviceValue)),
    row(t.amount, `<strong>${esc(money(d.amountMinor, d.currency))}</strong>`),
    row(t.paidAt, `${esc(when(d.paidAt, locale))} (${t.tz})`),
    row(t.activatedAt, `${esc(when(d.activatedAt, locale))} (${t.tz})`),
    row(t.opensAt, d.unlockAt ? `${esc(when(d.unlockAt, locale, d.unlockTimeZone ?? "Asia/Tbilisi"))} (${esc(d.unlockTimeZone ?? "Asia/Tbilisi")})` : esc(t.opensNow)),
    row(t.availableUntil, `${esc(when(d.availableUntil, locale))} (${t.tz})`),
    row(t.legal, esc(t.legalValue(d.consent?.policiesEffectiveDate ?? null))),
  ].join("");
  let consentBlock: string;
  if (!d.consent) consentBlock = `<p>${esc(t.noConsent)}</p>`;
  else {
    const at = `<p class="m">${esc(t.consentAt)}: ${esc(when(d.consent.acceptedAt, locale))} (${t.tz})</p>`;
    consentBlock = d.consent.statements
      ? `<ul>${d.consent.statements.map((s) => `<li>☑ ${esc(s)}</li>`).join("")}</ul>${at}`
      : `<p>${esc(t.noStatements)}</p><p class="m"><code>${esc(d.consent.sha256)}</code></p>${at}`;
  }
  return `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>QR Starr — ${esc(t.title)} ${esc(orderReference(d.orderId))}</title>
<style>
body{font:15px/1.55 system-ui,-apple-system,"Segoe UI","Noto Sans Georgian",sans-serif;color:#2b1c21;background:#fff;margin:0;padding:24px 16px}
main{max-width:640px;margin:0 auto}
h1{font-size:20px;margin:0 0 8px;color:#6e2236}
h2{font-size:15px;margin:24px 0 8px}
table{border-collapse:collapse;width:100%}
th,td{text-align:left;vertical-align:top;padding:8px 0;border-bottom:1px solid #e6dcd2}
th{width:42%;font-weight:600;padding-right:12px;color:#6d5a60}
ul{padding-left:0;list-style:none;margin:0}li{margin:0 0 8px}
.m,small,footer{color:#6d5a60;font-size:13px}code{word-break:break-all}
.r{color:#8a4b00;font-weight:600}
</style></head><body><main>
<p class="m">QR Starr · qrapp.ge</p>
<h1>${esc(t.title)}</h1>
<p>${esc(t.intro)}</p>
${d.orderStatus === "REFUNDED" ? `<p class="r">${esc(t.statusRefunded)}</p>` : ""}
<table>${rows}</table>
<h2>${esc(t.consents)}</h2>
${consentBlock}
<p>${esc(t.withdrawal)}</p>
<p class="m">${esc(t.links)}</p>
<footer><p>${esc(t.footer)}: ${esc(when(now, locale))} (${t.tz})</p></footer>
</main></body></html>
`;
}
