import "server-only";
import { sendEmail } from "@/lib/notify/email";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function formatExpiry(expiresAt: Date, locale: "ka" | "en"): string {
  return new Intl.DateTimeFormat(locale === "ka" ? "ka-GE" : "en-GB", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Tbilisi",
  }).format(expiresAt);
}

/** "25.11 01:13" in Tbilisi time: makes each link's subject distinct. */
function shortExpiry(expiresAt: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Tbilisi",
  }).formatToParts(expiresAt);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("day")}.${part("month")} ${part("hour")}:${part("minute")}`;
}

/**
 * The partner activation / password-reset email. Bilingual (Georgian first),
 * plain text plus minimal HTML, no images or tracking. The link is the only
 * secret and is never logged by this module.
 *
 * Each link gets its own subject (expiry time) and X-Entity-Ref-ID, and the
 * link comes first. Re-sent links used to share one subject and an almost
 * identical body, so Gmail merged them into one conversation and hid the
 * repeated tail (button included) behind "Show trimmed content".
 */
export function buildPartnerLinkEmail(message: {
  to: string;
  partnerName: string;
  link: string;
  purpose: "ACTIVATION" | "RECOVERY";
  expiresAt: Date;
  invitationId: string;
}) {
  const activation = message.purpose === "ACTIVATION";
  const subject = `${
    activation
      ? "QR STARR — პარტნიორის ანგარიშის გააქტიურება / Activate your partner account"
      : "QR STARR — პაროლის აღდგენა / Reset your partner password"
  } · ${shortExpiry(message.expiresAt)}`;
  const ka = activation
    ? `გამარჯობა! QR STARR-მა „${message.partnerName}“-ისთვის პარტნიორის ანგარიში შექმნა. გასააქტიურებლად გახსენით ბმული და აირჩიეთ პაროლი.`
    : `„${message.partnerName}“-ის პარტნიორის ანგარიშისთვის პაროლის აღდგენა მოითხოვეს. ახალი პაროლის დასაყენებლად გახსენით ბმული.`;
  const en = activation
    ? `Hello! QR STARR has created a partner account for "${message.partnerName}". Open the link and choose a password to activate it.`
    : `A password reset was requested for the "${message.partnerName}" partner account. Open the link to set a new password.`;
  const kaExpiry = `ბმული ერთჯერადია და მოქმედებს ${formatExpiry(message.expiresAt, "ka")}-მდე.`;
  const enExpiry = `The link works once and expires ${formatExpiry(message.expiresAt, "en")} (Tbilisi time).`;
  const ignore = "თუ ეს თქვენ არ გეხებათ, უბრალოდ წაშალეთ წერილი. / If this wasn't meant for you, delete this email.";
  const buttonLabel = activation ? "გააქტიურება / Activate" : "პაროლის შეცვლა / Reset password";
  const fallback = "თუ ღილაკი არ იხსნება, გახსენით ეს ბმული / If the button doesn't open, use this link:";
  const href = escapeHtml(message.link);

  const text = [`${buttonLabel}:`, message.link, "", kaExpiry, enExpiry, "", ka, "", en, "", ignore].join("\n");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1b1b1b;line-height:1.5;max-width:560px;margin:0 auto;padding:24px">
<p style="margin:0 0 16px"><a href="${href}" style="display:inline-block;background:#1b1b1b;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none">${buttonLabel}</a></p>
<p style="font-size:13px;color:#444;margin:0 0 20px">${escapeHtml(fallback)}<br><a href="${href}" style="color:#1b1b1b;word-break:break-all">${href}</a></p>
<p><small>${escapeHtml(kaExpiry)}<br>${escapeHtml(enExpiry)}</small></p>
<p>${escapeHtml(ka)}</p>
<p>${escapeHtml(en)}</p>
<p style="color:#666;font-size:13px">${escapeHtml(ignore)}</p>
</body></html>`;

  return {
    to: message.to,
    subject,
    text,
    html,
    idempotencyKey: `partner-link-${message.invitationId}`,
    headers: { "X-Entity-Ref-ID": message.invitationId },
  };
}

export async function sendPartnerLinkEmail(message: Parameters<typeof buildPartnerLinkEmail>[0]): Promise<void> {
  await sendEmail(buildPartnerLinkEmail(message));
}
