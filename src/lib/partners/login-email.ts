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

/**
 * The partner activation / password-reset email. Bilingual (Georgian first),
 * plain text plus minimal HTML, no images or tracking. The link is the only
 * secret and is never logged by this module.
 */
export async function sendPartnerLinkEmail(message: {
  to: string;
  partnerName: string;
  link: string;
  purpose: "ACTIVATION" | "RECOVERY";
  expiresAt: Date;
  invitationId: string;
}): Promise<void> {
  const activation = message.purpose === "ACTIVATION";
  const subject = activation
    ? "QR STARR — პარტნიორის ანგარიშის გააქტიურება / Activate your partner account"
    : "QR STARR — პაროლის აღდგენა / Reset your partner password";
  const ka = activation
    ? `გამარჯობა! QR STARR-მა „${message.partnerName}“-ისთვის პარტნიორის ანგარიში შექმნა. გასააქტიურებლად გახსენით ბმული და აირჩიეთ პაროლი.`
    : `„${message.partnerName}“-ის პარტნიორის ანგარიშისთვის პაროლის აღდგენა მოითხოვეს. ახალი პაროლის დასაყენებლად გახსენით ბმული.`;
  const en = activation
    ? `Hello! QR STARR has created a partner account for "${message.partnerName}". Open the link and choose a password to activate it.`
    : `A password reset was requested for the "${message.partnerName}" partner account. Open the link to set a new password.`;
  const kaExpiry = `ბმული ერთჯერადია და მოქმედებს ${formatExpiry(message.expiresAt, "ka")}-მდე.`;
  const enExpiry = `The link works once and expires ${formatExpiry(message.expiresAt, "en")} (Tbilisi time).`;
  const ignore = "თუ ეს თქვენ არ გეხებათ, უბრალოდ წაშალეთ წერილი. / If this wasn't meant for you, delete this email.";

  const text = [ka, kaExpiry, "", en, enExpiry, "", message.link, "", ignore].join("\n");
  const html = `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1b1b1b;line-height:1.5;max-width:560px;margin:0 auto;padding:24px">
<p>${escapeHtml(ka)}<br><small>${escapeHtml(kaExpiry)}</small></p>
<p>${escapeHtml(en)}<br><small>${escapeHtml(enExpiry)}</small></p>
<p><a href="${escapeHtml(message.link)}" style="display:inline-block;background:#1b1b1b;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none">${activation ? "გააქტიურება / Activate" : "პაროლის შეცვლა / Reset password"}</a></p>
<p style="color:#666;font-size:13px">${escapeHtml(ignore)}</p>
</body></html>`;

  await sendEmail({ to: message.to, subject, text, html, idempotencyKey: `partner-link-${message.invitationId}` });
}
