import "server-only";
import { appendFileSync } from "node:fs";
import { env } from "@/lib/env";

export type OutgoingEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Same key = same message: a retried send is not delivered twice. */
  idempotencyKey: string;
  /** Extra MIME headers (e.g. X-Entity-Ref-ID so mail apps don't merge distinct messages). */
  headers?: Record<string, string>;
};

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("Email delivery is not configured (PARTNER_EMAIL_TRANSPORT)");
    this.name = "EmailNotConfiguredError";
  }
}

export class EmailSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailSendError";
  }
}

export function emailDeliveryConfigured(): boolean {
  return env.PARTNER_EMAIL_TRANSPORT !== undefined;
}

/**
 * Sends one transactional email. Partner activation and reset links are the
 * only callers. Fails loudly: a link the person never receives must not look
 * like a sent invitation, so callers run this inside the transaction that
 * records the invitation and let a failure roll it back.
 *
 * "log" (development only, refused when hosted by env-guards) prints a
 * one-line notice and appends the full message to PARTNER_EMAIL_LOG_FILE, so
 * local tests can read the link without a mail server.
 */
export async function sendEmail(message: OutgoingEmail): Promise<void> {
  switch (env.PARTNER_EMAIL_TRANSPORT) {
    case "resend":
      return sendViaResend(message);
    case "log": {
      console.info(`[email:log] to=${message.to} subject=${JSON.stringify(message.subject)}`);
      if (env.PARTNER_EMAIL_LOG_FILE) {
        appendFileSync(env.PARTNER_EMAIL_LOG_FILE, `${JSON.stringify({ ...message, at: new Date().toISOString() })}\n`, { mode: 0o600 });
      }
      return;
    }
    default:
      throw new EmailNotConfiguredError();
  }
}

/** Resend's API key (not a Supabase key, so lib/supabase apiKeyHeaders doesn't apply). */
function resendAuthorization(): string {
  return "Bearer " + (env.RESEND_API_KEY ?? "");
}

async function sendViaResend(message: OutgoingEmail): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: resendAuthorization(),
        "Content-Type": "application/json",
        "Idempotency-Key": message.idempotencyKey,
      },
      body: JSON.stringify({
        from: env.PARTNER_EMAIL_FROM,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
        ...(message.headers ? { headers: message.headers } : {}),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      // Status only: the body can echo the recipient and message.
      throw new EmailSendError(`Email provider refused the message (HTTP ${response.status})`);
    }
  } catch (err) {
    if (err instanceof EmailSendError) throw err;
    throw new EmailSendError("Email provider could not be reached");
  } finally {
    clearTimeout(timer);
  }
}
