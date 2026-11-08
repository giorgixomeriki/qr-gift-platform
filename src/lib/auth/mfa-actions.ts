"use server";

import { z } from "zod";
import { withAdminContext } from "@/db/client";
import { recordAuditLog } from "@/lib/audit";
import { logServerError } from "@/lib/log";
import { enforceRateLimit, RateLimitedError } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAdminAccess } from "./admin";

/**
 * Admin TOTP, on Supabase Auth's own MFA API: no secret is generated, stored
 * or compared here. These run server-side so the app can rate-limit and audit
 * them. The resulting aal2 session is written to the auth cookies by the
 * server client.
 */
export type MfaErrorCode = "INVALID_CODE" | "RATE_LIMITED" | "FORBIDDEN" | "LAST_FACTOR" | "FAILED";
export type MfaResult = { ok: true } | { ok: false; error: MfaErrorCode };
export type EnrollmentResult = { ok: true; factorId: string; qrCode: string; secret: string } | { ok: false; error: MfaErrorCode };

const codeSchema = z.string().regex(/^\d{6}$/);
const factorIdSchema = z.string().uuid();

const VERIFY_LIMIT = { limit: 10, windowSeconds: 300 };
const ENROLL_LIMIT = { limit: 10, windowSeconds: 3600 };

function audit(userId: string, action: string, factorId: string, metadata: Record<string, unknown> = {}) {
  return withAdminContext(userId, (tx) =>
    recordAuditLog(tx, { actorType: "ADMIN", actorId: userId, action, targetType: "auth_mfa_factor", targetId: factorId, metadata }),
  );
}

function failure(scope: string, err: unknown): { ok: false; error: MfaErrorCode } {
  if (err instanceof RateLimitedError) return { ok: false, error: "RATE_LIMITED" };
  logServerError(scope, err);
  return { ok: false, error: "FAILED" };
}

/**
 * Starts enrolling a factor. Allowed for an admin with no factor yet (first
 * sign-in) or a fully verified admin adding a backup, never for an aal1
 * session on an account that already has a factor, because that would let a
 * stolen password register the attacker's own device.
 */
export async function startMfaEnrollmentAction(): Promise<EnrollmentResult> {
  try {
    const { access, user } = await getAdminAccess();
    if (!user || (access !== "MFA_ENROLL" && access !== "GRANTED")) return { ok: false, error: "FORBIDDEN" };
    await enforceRateLimit({ key: `admin-mfa-enroll:${user.id}`, ...ENROLL_LIMIT });

    const supabase = await createSupabaseServerClient();
    const { data: existing, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError) throw listError;
    // An abandoned attempt must not pile up against the factor limit.
    for (const stale of existing.all.filter((f) => f.status === "unverified")) {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: stale.id });
      if (error) throw error;
    }

    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `totp-${Date.now()}`, issuer: "QR Starr" });
    if (error) throw error;
    return { ok: true, factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
  } catch (err) {
    return failure("adminMfaEnroll", err);
  }
}

/** Shared by enrollment confirmation and sign-in: checks one code against one of this user's own factors. */
async function verifyCode(factorId: string, code: string, allowedFactorIds: Set<string> | null, userId: string, successAction: string): Promise<MfaResult> {
  await enforceRateLimit({ key: `admin-mfa-verify:${userId}`, ...VERIFY_LIMIT });
  const parsedFactor = factorIdSchema.safeParse(factorId);
  if (!parsedFactor.success || (allowedFactorIds && !allowedFactorIds.has(parsedFactor.data))) return { ok: false, error: "FORBIDDEN" };
  if (!codeSchema.safeParse(code).success) return { ok: false, error: "INVALID_CODE" };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: parsedFactor.data, code });
  if (error) {
    await audit(userId, "ADMIN_MFA_VERIFY_FAILED", parsedFactor.data);
    return { ok: false, error: "INVALID_CODE" };
  }
  await audit(userId, successAction, parsedFactor.data);
  return { ok: true };
}

export async function confirmMfaEnrollmentAction(factorId: string, code: string): Promise<MfaResult> {
  try {
    const { access, user } = await getAdminAccess();
    if (!user || (access !== "MFA_ENROLL" && access !== "GRANTED")) return { ok: false, error: "FORBIDDEN" };
    return await verifyCode(factorId, code, null, user.id, "ADMIN_MFA_ENROLLED");
  } catch (err) {
    return failure("adminMfaConfirm", err);
  }
}

export async function verifyMfaChallengeAction(factorId: string, code: string): Promise<MfaResult> {
  try {
    const { access, user, factors } = await getAdminAccess();
    if (!user || access !== "MFA_CHALLENGE") return { ok: false, error: "FORBIDDEN" };
    return await verifyCode(factorId, code, new Set(factors.map((f) => f.id)), user.id, "ADMIN_MFA_VERIFIED");
  } catch (err) {
    return failure("adminMfaVerify", err);
  }
}

/** Removing is aal2-only and can never leave the account without a factor. */
export async function removeMfaFactorAction(factorId: string): Promise<MfaResult> {
  try {
    const { access, user, factors } = await getAdminAccess();
    if (!user || access !== "GRANTED" || !factors.some((f) => f.id === factorId)) return { ok: false, error: "FORBIDDEN" };
    if (factors.length < 2) return { ok: false, error: "LAST_FACTOR" };

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) throw error;
    await audit(user.id, "ADMIN_MFA_REMOVED", factorId);
    return { ok: true };
  } catch (err) {
    return failure("adminMfaRemove", err);
  }
}
