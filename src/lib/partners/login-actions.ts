"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { MfaRequiredError, requireAdmin, UnauthorizedError } from "@/lib/auth/admin";
import { authDirectory } from "@/lib/auth/auth-directory";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { emailDeliveryConfigured } from "@/lib/notify/email";
import { getClientIp, RateLimitedError, enforceRateLimit } from "@/lib/rate-limit";
import { logServerError } from "@/lib/log";
import { toAuthPhone } from "./contact";
import { sendPartnerLinkEmail } from "./login-email";
import {
  activateWithEmailLink,
  blockRevokedLogins,
  completePhoneSignIn,
  issueActivation,
  issueRecovery,
  LoginAccessError,
  requestPhoneSignInCode,
  revokeInvitation,
  revokeLogin,
  setPartnerContacts,
  type IssueDeps,
  type LoginAccessErrorCode,
  type PhoneDeps,
} from "./login-access";

/**
 * Server actions for partner login access. Results carry a stable error
 * code (translated by the UI), never a raw provider or database message.
 */
type FailCode = LoginAccessErrorCode | "rate_limited" | "unauthorized" | "mfa_required" | "failed";
export type LoginActionResult<T = object> = ({ ok: true } & T) | { ok: false; code: FailCode };

function fail(scope: string, err: unknown): { ok: false; code: FailCode } {
  if (err instanceof LoginAccessError) return { ok: false, code: err.code };
  if (err instanceof RateLimitedError) return { ok: false, code: "rate_limited" };
  if (err instanceof MfaRequiredError) return { ok: false, code: "mfa_required" };
  if (err instanceof UnauthorizedError) return { ok: false, code: "unauthorized" };
  logServerError(scope, err);
  return { ok: false, code: "failed" };
}

function issueDeps(): IssueDeps {
  return {
    directory: authDirectory(),
    sendLinkEmail: sendPartnerLinkEmail,
    emailConfigured: emailDeliveryConfigured(),
    phoneEnabled: env.PARTNER_PHONE_AUTH_ENABLED,
    appUrl: env.NEXT_PUBLIC_APP_URL,
    ttlHours: env.PARTNER_INVITE_TTL_HOURS,
  };
}

async function clientIp(): Promise<string> {
  return getClientIp(await headers());
}

// ---- Admin ---------------------------------------------------------------

export async function adminSetPartnerContactsAction(partnerId: string, input: { email?: string; phone?: string }): Promise<LoginActionResult> {
  try {
    await requireAdmin((tx, adminUserId) => setPartnerContacts(tx, adminUserId, partnerId, input, { requireEmail: !env.PARTNER_PHONE_AUTH_ENABLED }));
    revalidatePath(`/admin/partners/${partnerId}`);
    return { ok: true };
  } catch (err) {
    return fail("adminSetPartnerContactsAction", err);
  }
}

export async function adminSendActivationAction(partnerId: string, channel: "EMAIL" | "PHONE"): Promise<LoginActionResult<{ expiresAt: string }>> {
  try {
    if (channel !== "EMAIL" && channel !== "PHONE") throw new LoginAccessError("not_found");
    const result = await requireAdmin(async (tx, adminUserId) => {
      await enforceRateLimit({ key: `partner-invite-admin:${adminUserId}`, limit: 20, windowSeconds: 3600 });
      return issueActivation(tx, adminUserId, partnerId, channel, issueDeps());
    });
    revalidatePath(`/admin/partners/${partnerId}`);
    return { ok: true, expiresAt: result.expiresAt.toISOString() };
  } catch (err) {
    return fail("adminSendActivationAction", err);
  }
}

export async function adminSendPasswordResetAction(partnerId: string): Promise<LoginActionResult<{ expiresAt: string }>> {
  try {
    const result = await requireAdmin(async (tx, adminUserId) => {
      await enforceRateLimit({ key: `partner-invite-admin:${adminUserId}`, limit: 20, windowSeconds: 3600 });
      return issueRecovery(tx, adminUserId, partnerId, issueDeps());
    });
    revalidatePath(`/admin/partners/${partnerId}`);
    return { ok: true, expiresAt: result.expiresAt.toISOString() };
  } catch (err) {
    return fail("adminSendPasswordResetAction", err);
  }
}

export async function adminRevokeInvitationAction(partnerId: string): Promise<LoginActionResult> {
  try {
    await requireAdmin((tx, adminUserId) => revokeInvitation(tx, adminUserId, partnerId));
    revalidatePath(`/admin/partners/${partnerId}`);
    return { ok: true };
  } catch (err) {
    return fail("adminRevokeInvitationAction", err);
  }
}

export async function adminRevokeLoginAction(partnerId: string): Promise<LoginActionResult<{ blocked: number }>> {
  try {
    const removed = await requireAdmin((tx, adminUserId) => revokeLogin(tx, adminUserId, partnerId));
    // After commit: access already ended in the database; this also ends the
    // Auth sessions of accounts that have no other role.
    const blocked = await blockRevokedLogins(removed, authDirectory());
    revalidatePath(`/admin/partners/${partnerId}`);
    return { ok: true, blocked: blocked.length };
  } catch (err) {
    return fail("adminRevokeLoginAction", err);
  }
}

// ---- Person (no partner session yet) -------------------------------------

export async function activatePartnerLinkAction(token: string, password: string): Promise<LoginActionResult> {
  try {
    if (typeof token !== "string" || typeof password !== "string") throw new LoginAccessError("invalid_link");
    await activateWithEmailLink(token, password, await clientIp(), {
      directory: authDirectory(),
      signIn: async (email, pw) => {
        const supabase = await createSupabaseServerClient();
        const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
        if (error) throw new Error("Sign-in after activation failed");
        // Lock out any session that predates this activation / reset.
        await supabase.auth.signOut({ scope: "others" });
      },
    });
    return { ok: true };
  } catch (err) {
    return fail("activatePartnerLinkAction", err);
  }
}

function phoneDeps(): PhoneDeps {
  return {
    directory: authDirectory(),
    phoneEnabled: env.PARTNER_PHONE_AUTH_ENABLED,
    sendOtp: async (phone) => {
      const supabase = await createSupabaseServerClient();
      const { error } = await supabase.auth.signInWithOtp({ phone, options: { shouldCreateUser: false, channel: "sms" } });
      if (error) throw new Error(`OTP send refused${error.code ? ` (${error.code})` : ""}`);
    },
    verifyOtp: async (phone, code) => {
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase.auth.verifyOtp({ phone: toAuthPhone(phone), token: code, type: "sms" });
      if (error || !data.user) return null;
      return { userId: data.user.id };
    },
    signOut: async () => {
      const supabase = await createSupabaseServerClient();
      await supabase.auth.signOut();
    },
    endOtherSessions: async () => {
      const supabase = await createSupabaseServerClient();
      await supabase.auth.signOut({ scope: "others" });
    },
  };
}

export async function requestPartnerPhoneCodeAction(phone: string): Promise<LoginActionResult> {
  try {
    if (typeof phone !== "string") throw new LoginAccessError("invalid_phone");
    await requestPhoneSignInCode(phone, await clientIp(), phoneDeps());
    return { ok: true };
  } catch (err) {
    return fail("requestPartnerPhoneCodeAction", err);
  }
}

export async function verifyPartnerPhoneCodeAction(phone: string, code: string): Promise<LoginActionResult> {
  try {
    if (typeof phone !== "string" || typeof code !== "string") throw new LoginAccessError("invalid_code");
    await completePhoneSignIn(phone, code, await clientIp(), phoneDeps());
    return { ok: true };
  } catch (err) {
    return fail("verifyPartnerPhoneCodeAction", err);
  }
}
