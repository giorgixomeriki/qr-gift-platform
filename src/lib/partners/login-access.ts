import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { checkIsAdmin, db, type Tx } from "@/db/client";
import { partnerInvitations, partnerMembers, partners } from "@/db/schema";
import { recordAuditLog } from "@/lib/audit";
import type { AuthDirectory, AuthUserSummary } from "@/lib/auth/auth-directory";
import { enforceRateLimit } from "@/lib/rate-limit";
import { maskEmail, maskPhone, normalizeEmail, normalizeGeorgianMobile } from "./contact";
import { PASSWORD_MAX_LENGTH_PUBLIC, PASSWORD_MIN_LENGTH_PUBLIC } from "./login-rules";

/**
 * Partner login access: one partner = one login, linked only after the
 * person proves control of the partner's registered contact.
 *
 *   EMAIL  the admin sends a single-use activation link to the partner's
 *          email (only its SHA-256 is stored). Opening it and choosing a
 *          password creates — or, for an unlinked existing account, resets —
 *          the login and links it. The admin can later send a single-use
 *          password-reset link the same way (RECOVERY).
 *   PHONE  the admin opens phone sign-in for the partner's Georgian mobile.
 *          The person signs in with an SMS code sent and checked by Supabase
 *          Auth; the verified phone claims the open invitation.
 *
 * Every link goes through app_accept_partner_invitation() (migrations/0023),
 * which re-checks the rules under row locks: unexpired, unused, contact
 * matches, partner active, partner has no login yet, the login has no
 * partner yet, and the login is not a platform admin.
 *
 * Nothing here touches QR codes, orders, payments, the ledger or payouts.
 */

export type LoginAccessErrorCode =
  | "invalid_link"
  | "link_used"
  | "link_expired"
  | "partner_inactive"
  | "contact_mismatch"
  | "partner_has_login"
  | "user_has_partner"
  | "admin_account"
  | "recovery_target_mismatch"
  | "no_contact"
  | "contact_required"
  | "contact_in_use"
  | "invalid_email"
  | "invalid_phone"
  | "invalid_code"
  | "phone_auth_disabled"
  | "email_not_configured"
  | "weak_password"
  | "no_login"
  | "login_not_email"
  | "not_found";

export class LoginAccessError extends Error {
  constructor(public readonly code: LoginAccessErrorCode) {
    super(code);
    this.name = "LoginAccessError";
  }
}

const DB_ERROR_CODES = new Set<LoginAccessErrorCode>([
  "invalid_link",
  "partner_inactive",
  "contact_mismatch",
  "partner_has_login",
  "user_has_partner",
  "admin_account",
  "recovery_target_mismatch",
]);

/** Maps the function's raised codes (and its "invitation_*" spellings) to ours. */
function mapDbError(err: unknown): never {
  const message = err instanceof Error ? err.message : "";
  const cause = (err as { cause?: { message?: string } })?.cause?.message ?? "";
  const raw = [message, cause].join(" ");
  if (/invitation_used/.test(raw)) throw new LoginAccessError("link_used");
  if (/invitation_expired/.test(raw)) throw new LoginAccessError("link_expired");
  if (/invitation_invalid/.test(raw)) throw new LoginAccessError("invalid_link");
  for (const code of DB_ERROR_CODES) {
    if (new RegExp(`\\b${code}\\b`).test(raw)) throw new LoginAccessError(code);
  }
  throw err;
}

export const PASSWORD_MIN_LENGTH = PASSWORD_MIN_LENGTH_PUBLIC;
export const PASSWORD_MAX_LENGTH = PASSWORD_MAX_LENGTH_PUBLIC;

export function newActivationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashActivationToken(token) };
}

export function hashActivationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** A token as we issue it: 43 base64url characters. Anything else is refused before any lookup. */
export function isWellFormedToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

// ---------------------------------------------------------------------------
// Admin side (callers run these inside requireAdmin's transaction)
// ---------------------------------------------------------------------------

export type ContactsInput = { email?: string | null; phone?: string | null };

/** Normalizes admin-entered contacts; at least one is required. */
export function parseContacts(input: ContactsInput): { email: string | null; phone: string | null } {
  const rawEmail = input.email?.trim() ? input.email : null;
  const rawPhone = input.phone?.trim() ? input.phone : null;
  const email = rawEmail === null ? null : normalizeEmail(rawEmail);
  const phone = rawPhone === null ? null : normalizeGeorgianMobile(rawPhone);
  if (rawEmail !== null && email === null) throw new LoginAccessError("invalid_email");
  if (rawPhone !== null && phone === null) throw new LoginAccessError("invalid_phone");
  if (email === null && phone === null) throw new LoginAccessError("contact_required");
  return { email, phone };
}

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string; cause?: { code?: string } })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

export async function setPartnerContacts(tx: Tx, adminUserId: string, partnerId: string, input: ContactsInput) {
  const { email, phone } = parseContacts(input);
  let updated;
  try {
    [updated] = await tx
      .update(partners)
      .set({ contactEmail: email, contactPhone: phone, updatedAt: new Date() })
      .where(eq(partners.id, partnerId))
      .returning({ id: partners.id });
  } catch (err) {
    if (isUniqueViolation(err)) throw new LoginAccessError("contact_in_use");
    throw err;
  }
  if (!updated) throw new LoginAccessError("not_found");

  // An open invitation addressed to a contact that is no longer the partner's
  // must stop working.
  const pending = await tx
    .select({ id: partnerInvitations.id, channel: partnerInvitations.channel, contact: partnerInvitations.contact })
    .from(partnerInvitations)
    .where(and(eq(partnerInvitations.partnerId, partnerId), eq(partnerInvitations.status, "PENDING")));
  for (const inv of pending) {
    const current = inv.channel === "EMAIL" ? email : phone;
    if (inv.contact !== current) await revokePending(tx, adminUserId, partnerId, "CONTACT_CHANGED");
  }

  await recordAuditLog(tx, {
    actorType: "ADMIN",
    actorId: adminUserId,
    action: "PARTNER_CONTACTS_UPDATED",
    targetType: "partner",
    targetId: partnerId,
    metadata: { email: email ? maskEmail(email) : null, phone: phone ? maskPhone(phone) : null },
  });
  return { email, phone };
}

async function revokePending(tx: Tx, adminUserId: string, partnerId: string, reason: string): Promise<number> {
  const revoked = await tx
    .update(partnerInvitations)
    .set({ status: "REVOKED", revokedBy: adminUserId, revokedAt: new Date() })
    .where(and(eq(partnerInvitations.partnerId, partnerId), eq(partnerInvitations.status, "PENDING")))
    .returning({ id: partnerInvitations.id });
  for (const row of revoked) {
    await recordAuditLog(tx, {
      actorType: "ADMIN",
      actorId: adminUserId,
      action: "PARTNER_INVITATION_REVOKED",
      targetType: "partner",
      targetId: partnerId,
      metadata: { invitationId: row.id, reason },
    });
  }
  return revoked.length;
}

async function partnerCount(tx: Tx, userId: string): Promise<number> {
  const [row] = await tx.execute<{ n: number }>(sql`select app_user_partner_count(${userId}::uuid) as n`);
  return Number(row?.n ?? 0);
}

async function lockPartner(tx: Tx, partnerId: string) {
  const [row] = await tx
    .select({ id: partners.id, name: partners.name, status: partners.status, contactEmail: partners.contactEmail, contactPhone: partners.contactPhone, defaultLocale: partners.defaultLocale })
    .from(partners)
    .where(eq(partners.id, partnerId))
    .for("update");
  if (!row) throw new LoginAccessError("not_found");
  return row;
}

export type IssueDeps = {
  directory: AuthDirectory;
  /** Sends the link email; must throw on failure so the invitation rolls back. */
  sendLinkEmail: (message: { to: string; partnerName: string; link: string; purpose: "ACTIVATION" | "RECOVERY"; expiresAt: Date; invitationId: string }) => Promise<void>;
  emailConfigured: boolean;
  phoneEnabled: boolean;
  appUrl: string;
  ttlHours: number;
  isAdmin?: (userId: string) => Promise<boolean>;
};

/** Refuses up front an existing account that could never be linked, so the admin learns now, not the partner later. */
async function assertLinkable(tx: Tx, deps: IssueDeps, existing: AuthUserSummary | null) {
  if (!existing) return;
  if (await (deps.isAdmin ?? checkIsAdmin)(existing.id)) throw new LoginAccessError("admin_account");
  if ((await partnerCount(tx, existing.id)) > 0) throw new LoginAccessError("user_has_partner");
}

export async function issueActivation(
  tx: Tx,
  adminUserId: string,
  partnerId: string,
  channel: "EMAIL" | "PHONE",
  deps: IssueDeps,
): Promise<{ invitationId: string; channel: "EMAIL" | "PHONE"; expiresAt: Date }> {
  const partner = await lockPartner(tx, partnerId);
  if (partner.status !== "ACTIVE") throw new LoginAccessError("partner_inactive");
  const contact = channel === "EMAIL" ? partner.contactEmail : partner.contactPhone;
  if (!contact) throw new LoginAccessError("no_contact");
  if (channel === "EMAIL" && !deps.emailConfigured) throw new LoginAccessError("email_not_configured");
  if (channel === "PHONE" && !deps.phoneEnabled) throw new LoginAccessError("phone_auth_disabled");

  const [member] = await tx.select({ id: partnerMembers.id }).from(partnerMembers).where(eq(partnerMembers.partnerId, partnerId)).limit(1);
  if (member) throw new LoginAccessError("partner_has_login");

  const existing = channel === "EMAIL" ? await deps.directory.findByEmail(contact) : await deps.directory.findByPhone(contact);
  await assertLinkable(tx, deps, existing);

  await revokePending(tx, adminUserId, partnerId, "REISSUED");
  const expiresAt = new Date(Date.now() + deps.ttlHours * 3600_000);
  const issued = channel === "EMAIL" ? newActivationToken() : null;
  const [inv] = await tx
    .insert(partnerInvitations)
    .values({ partnerId, channel, purpose: "ACTIVATION", contact, tokenHash: issued?.tokenHash ?? null, expiresAt, createdBy: adminUserId })
    .returning({ id: partnerInvitations.id });
  if (!inv) throw new Error("Failed to record the invitation");

  await recordAuditLog(tx, {
    actorType: "ADMIN",
    actorId: adminUserId,
    action: "PARTNER_LOGIN_INVITED",
    targetType: "partner",
    targetId: partnerId,
    metadata: { invitationId: inv.id, channel, contact: channel === "EMAIL" ? maskEmail(contact) : maskPhone(contact), expiresAt: expiresAt.toISOString() },
  });

  if (issued) {
    await deps.sendLinkEmail({
      to: contact,
      partnerName: partner.name,
      link: `${deps.appUrl.replace(/\/$/, "")}/partner/activate?token=${issued.token}`,
      purpose: "ACTIVATION",
      expiresAt,
      invitationId: inv.id,
    });
  }
  return { invitationId: inv.id, channel, expiresAt };
}

/** Admin-sent single-use password reset for the partner's linked email login. */
export async function issueRecovery(tx: Tx, adminUserId: string, partnerId: string, deps: IssueDeps) {
  const partner = await lockPartner(tx, partnerId);
  if (partner.status !== "ACTIVE") throw new LoginAccessError("partner_inactive");
  if (!deps.emailConfigured) throw new LoginAccessError("email_not_configured");
  const members = await tx.select({ userId: partnerMembers.userId }).from(partnerMembers).where(eq(partnerMembers.partnerId, partnerId));
  if (members.length !== 1) throw new LoginAccessError("no_login");
  const target = await deps.directory.getById(members[0]!.userId);
  if (!target?.email || !partner.contactEmail || target.email !== partner.contactEmail) throw new LoginAccessError("login_not_email");

  await revokePending(tx, adminUserId, partnerId, "REISSUED");
  const expiresAt = new Date(Date.now() + Math.min(deps.ttlHours, 24) * 3600_000);
  const issued = newActivationToken();
  const [inv] = await tx
    .insert(partnerInvitations)
    .values({ partnerId, channel: "EMAIL", purpose: "RECOVERY", contact: target.email, tokenHash: issued.tokenHash, targetUserId: target.id, expiresAt, createdBy: adminUserId })
    .returning({ id: partnerInvitations.id });
  if (!inv) throw new Error("Failed to record the reset link");
  await recordAuditLog(tx, {
    actorType: "ADMIN",
    actorId: adminUserId,
    action: "PARTNER_LOGIN_RESET_SENT",
    targetType: "partner",
    targetId: partnerId,
    metadata: { invitationId: inv.id, contact: maskEmail(target.email), expiresAt: expiresAt.toISOString() },
  });
  await deps.sendLinkEmail({
    to: target.email,
    partnerName: partner.name,
    link: `${deps.appUrl.replace(/\/$/, "")}/partner/activate?token=${issued.token}`,
    purpose: "RECOVERY",
    expiresAt,
    invitationId: inv.id,
  });
  return { invitationId: inv.id, expiresAt };
}

export async function revokeInvitation(tx: Tx, adminUserId: string, partnerId: string): Promise<number> {
  return revokePending(tx, adminUserId, partnerId, "ADMIN");
}

/**
 * Removes the partner's login(s) and any open invitation. Access ends on the
 * next request: every partner page and action re-checks membership in the
 * database. Returns the removed user ids; the caller then calls
 * blockRevokedLogins() after commit to end their Auth sessions.
 */
export async function revokeLogin(tx: Tx, adminUserId: string, partnerId: string): Promise<string[]> {
  await lockPartner(tx, partnerId);
  await revokePending(tx, adminUserId, partnerId, "LOGIN_REVOKED");
  const removed = await tx
    .delete(partnerMembers)
    .where(eq(partnerMembers.partnerId, partnerId))
    .returning({ userId: partnerMembers.userId, role: partnerMembers.role });
  if (removed.length === 0) throw new LoginAccessError("no_login");
  await recordAuditLog(tx, {
    actorType: "ADMIN",
    actorId: adminUserId,
    action: "PARTNER_LOGIN_REVOKED",
    targetType: "partner",
    targetId: partnerId,
    metadata: { userIds: removed.map((r) => r.userId) },
  });
  return removed.map((r) => r.userId);
}

/**
 * After revokeLogin commits: bans each removed account that has no other
 * role (not an admin, no other partner), which ends its sessions and
 * refreshes in Supabase Auth. Accounts with another role keep signing in.
 */
export async function blockRevokedLogins(userIds: string[], directory: AuthDirectory, isAdmin: (id: string) => Promise<boolean> = checkIsAdmin) {
  const blocked: string[] = [];
  for (const userId of userIds) {
    if (await isAdmin(userId)) continue;
    const remaining = await db.transaction((tx) => partnerCount(tx, userId));
    if (remaining > 0) continue;
    await directory.setBanned(userId, true);
    blocked.push(userId);
  }
  return blocked;
}

export type LoginStatus = {
  contactEmail: string | null;
  contactPhone: string | null;
  logins: { userId: string; role: string; email: string | null; phone: string | null; lastSignInAt: string | null; banned: boolean }[];
  pending: { channel: "EMAIL" | "PHONE"; purpose: "ACTIVATION" | "RECOVERY"; contact: string; expiresAt: Date; createdAt: Date } | null;
};

export async function getLoginStatus(tx: Tx, partnerId: string, directory: AuthDirectory): Promise<LoginStatus> {
  const [partner] = await tx.select({ contactEmail: partners.contactEmail, contactPhone: partners.contactPhone }).from(partners).where(eq(partners.id, partnerId));
  if (!partner) throw new LoginAccessError("not_found");
  const members = await tx.select({ userId: partnerMembers.userId, role: partnerMembers.role }).from(partnerMembers).where(eq(partnerMembers.partnerId, partnerId));
  const logins = await Promise.all(
    members.map(async (m) => {
      const u = await directory.getById(m.userId).catch(() => null);
      return { userId: m.userId, role: m.role, email: u?.email ?? null, phone: u?.phone ?? null, lastSignInAt: u?.lastSignInAt ?? null, banned: u?.banned ?? false };
    }),
  );
  const [pending] = await tx
    .select({ channel: partnerInvitations.channel, purpose: partnerInvitations.purpose, contact: partnerInvitations.contact, expiresAt: partnerInvitations.expiresAt, createdAt: partnerInvitations.createdAt })
    .from(partnerInvitations)
    .where(and(eq(partnerInvitations.partnerId, partnerId), eq(partnerInvitations.status, "PENDING")))
    .limit(1);
  return { ...partner, logins, pending: pending ?? null };
}

// ---------------------------------------------------------------------------
// Person side: no session (email link) or a fresh SMS-verified session
// ---------------------------------------------------------------------------

type InvitationRow = {
  invitation_id: string;
  partner_id: string;
  partner_name: string;
  partner_active: boolean;
  channel: "EMAIL" | "PHONE";
  purpose: "ACTIVATION" | "RECOVERY";
  contact: string;
  target_user_id: string | null;
  status: "PENDING" | "ACCEPTED" | "REVOKED";
  expired: boolean;
};

async function findByToken(token: string): Promise<InvitationRow | null> {
  if (!isWellFormedToken(token)) return null;
  const hash = hashActivationToken(token);
  const rows = await db.transaction((tx) => tx.execute<InvitationRow>(sql`select * from app_partner_invitation_by_token(${hash})`));
  return rows[0] ?? null;
}

export type LinkPreview =
  | { state: "valid"; partnerName: string; maskedEmail: string; purpose: "ACTIVATION" | "RECOVERY" }
  | { state: "used" | "expired" | "invalid" | "inactive" };

/** What the activation page shows. Never reveals anything for a wrong token. */
export async function previewLink(token: string): Promise<LinkPreview> {
  const row = await findByToken(token);
  if (!row || row.channel !== "EMAIL") return { state: "invalid" };
  if (row.status === "ACCEPTED") return { state: "used" };
  if (row.status === "REVOKED") return { state: "invalid" };
  if (row.expired) return { state: "expired" };
  if (!row.partner_active) return { state: "inactive" };
  return { state: "valid", partnerName: row.partner_name, maskedEmail: maskEmail(row.contact), purpose: row.purpose };
}

async function acceptInvitation(tx: Tx, invitationId: string, userId: string, contact: string): Promise<string> {
  try {
    const [row] = await tx.execute<{ partner_id: string }>(
      sql`select app_accept_partner_invitation(${invitationId}::uuid, ${userId}::uuid, ${contact}) as partner_id`,
    );
    return row!.partner_id;
  } catch (err) {
    mapDbError(err);
  }
}

export function checkPassword(password: string) {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new LoginAccessError("weak_password");
  }
}

export type ActivateDeps = {
  directory: AuthDirectory;
  /**
   * Signs the person in (sets the session cookie) once the login is linked,
   * and ends every other session of that login (a reset must lock out
   * whoever knew the old password).
   */
  signIn: (email: string, password: string) => Promise<void>;
  isAdmin?: (userId: string) => Promise<boolean>;
};

/**
 * The emailed link's landing action. Holding the token proves control of
 * the email it was sent to, so it may create that login. An existing
 * account at that address is replaced only when no partner or admin role
 * depends on it (checked before anything is changed); otherwise refused.
 */
export async function activateWithEmailLink(token: string, password: string, ip: string, deps: ActivateDeps): Promise<{ partnerId: string }> {
  await enforceRateLimit({ key: `partner-activate-ip:${ip}`, limit: 10, windowSeconds: 900, failClosed: true });
  if (isWellFormedToken(token)) {
    await enforceRateLimit({ key: `partner-activate-token:${hashActivationToken(token).slice(0, 24)}`, limit: 5, windowSeconds: 900, failClosed: true });
  }
  checkPassword(password);

  const inv = await findByToken(token);
  if (!inv || inv.channel !== "EMAIL" || inv.status === "REVOKED") throw new LoginAccessError("invalid_link");
  if (inv.status === "ACCEPTED") throw new LoginAccessError("link_used");
  if (inv.expired) throw new LoginAccessError("link_expired");
  if (!inv.partner_active) throw new LoginAccessError("partner_inactive");
  const isAdmin = deps.isAdmin ?? checkIsAdmin;

  let partnerId: string;
  if (inv.purpose === "RECOVERY") {
    partnerId = await db.transaction(async (tx) => {
      const id = await acceptInvitation(tx, inv.invitation_id, inv.target_user_id!, inv.contact);
      const target = await deps.directory.getById(inv.target_user_id!);
      if (!target || target.email !== inv.contact) throw new LoginAccessError("contact_mismatch");
      // Last, so a failure rolls the claim back and the link stays usable.
      await deps.directory.setPassword(target.id, password);
      return id;
    });
  } else {
    const existing = await deps.directory.findByEmail(inv.contact);
    if (existing) {
      if (await isAdmin(existing.id)) throw new LoginAccessError("admin_account");
      if ((await db.transaction((tx) => partnerCount(tx, existing.id))) > 0) throw new LoginAccessError("user_has_partner");
      // An unlinked account at this address may have been registered by
      // someone else before the owner (pre-account hijacking) or still hold an
      // old session. Replace it, so the login that gets linked is created now,
      // by the holder of this link, with no session but the one started below.
      await deps.directory.deleteUser(existing.id);
    }
    const created = await deps.directory.createEmailUser(inv.contact, password);
    try {
      partnerId = await db.transaction((tx) => acceptInvitation(tx, inv.invitation_id, created.id, inv.contact));
    } catch (err) {
      // Don't leave an unlinked account behind a failed claim.
      await deps.directory.deleteUser(created.id).catch(() => {});
      throw err;
    }
  }

  await deps.signIn(inv.contact, password);
  return { partnerId };
}

export type PhoneDeps = {
  directory: AuthDirectory;
  phoneEnabled: boolean;
  /** Asks Supabase Auth to text a sign-in code to an existing account (never creates one). */
  sendOtp: (phoneE164: string) => Promise<void>;
  /** Checks the code with Supabase Auth; on success the session cookie is set. Returns the session's user id. */
  verifyOtp: (phoneE164: string, code: string) => Promise<{ userId: string } | null>;
  signOut: () => Promise<void>;
  /** Ends every session of this login except the current one. */
  endOtherSessions: () => Promise<void>;
  isAdmin?: (userId: string) => Promise<boolean>;
  log?: (message: string) => void;
};

/**
 * Step 1 of phone sign-in. Sends a code only to a number that is a linked
 * partner login, or that has an open phone invitation (creating its
 * unconfirmed account first). The reply never says which: callers show the
 * same message either way, so the form can't be used to discover partners.
 */
export async function requestPhoneSignInCode(phoneInput: string, ip: string, deps: PhoneDeps): Promise<void> {
  if (!deps.phoneEnabled) throw new LoginAccessError("phone_auth_disabled");
  const phone = normalizeGeorgianMobile(phoneInput);
  if (!phone) throw new LoginAccessError("invalid_phone");

  // Fail closed: every SMS costs money and can be used to harass a number.
  await enforceRateLimit({ key: `phone-otp-ip:${ip}`, limit: 10, windowSeconds: 3600, failClosed: true });
  await enforceRateLimit({ key: `phone-otp-send:${phone}`, limit: 3, windowSeconds: 900, failClosed: true });
  await enforceRateLimit({ key: `phone-otp-day:${phone}`, limit: 8, windowSeconds: 86400, failClosed: true });

  const isAdmin = deps.isAdmin ?? checkIsAdmin;
  const openInvitation = await db.transaction(async (tx) => {
    const [row] = await tx.execute<{ id: string | null }>(sql`select app_open_phone_invitation(${phone}) as id`);
    return row?.id ?? null;
  });
  let user = await deps.directory.findByPhone(phone);
  let eligible = false;

  if (user && (await isAdmin(user.id))) {
    eligible = false; // Admin accounts never sign in through the partner phone form.
  } else if (user) {
    const linked = (await db.transaction((tx) => partnerCount(tx, user!.id))) > 0;
    if (linked) eligible = user.phoneConfirmed && !user.banned;
    else if (openInvitation) {
      // A previously used, now unlinked number (revoked login, recycled
      // SIM): start a fresh account so nothing from before carries over.
      if (user.phoneConfirmed || user.banned) {
        await deps.directory.deleteUser(user.id);
        user = await deps.directory.createPhoneUser(phone);
      }
      eligible = true;
    }
  } else if (openInvitation) {
    user = await deps.directory.createPhoneUser(phone);
    eligible = true;
  }

  if (!eligible) return;
  try {
    await deps.sendOtp(phone);
  } catch (err) {
    // Same reply as success; the failure is for the operator's log.
    (deps.log ?? console.error)(`[partner-phone] code send failed: ${err instanceof Error ? err.message : "unknown"}`);
  }
}

/**
 * Step 2. Verifies the code with Supabase Auth, then: an already-linked login
 * is simply signed in; otherwise the verified phone claims its open
 * invitation. Anything else signs the fresh session straight back out.
 */
export async function completePhoneSignIn(phoneInput: string, code: string, ip: string, deps: PhoneDeps): Promise<{ partnerId: string | null }> {
  if (!deps.phoneEnabled) throw new LoginAccessError("phone_auth_disabled");
  const phone = normalizeGeorgianMobile(phoneInput);
  if (!phone) throw new LoginAccessError("invalid_phone");
  if (!/^\d{6}$/.test(code.trim())) throw new LoginAccessError("invalid_code");

  await enforceRateLimit({ key: `phone-verify-ip:${ip}`, limit: 20, windowSeconds: 900, failClosed: true });
  await enforceRateLimit({ key: `phone-verify:${phone}`, limit: 5, windowSeconds: 900, failClosed: true });

  const session = await deps.verifyOtp(phone, code.trim());
  if (!session) throw new LoginAccessError("invalid_code");

  try {
    const user = await deps.directory.getById(session.userId);
    if (!user || user.phone !== phone || !user.phoneConfirmed) throw new LoginAccessError("contact_mismatch");
    if (await (deps.isAdmin ?? checkIsAdmin)(user.id)) throw new LoginAccessError("admin_account");

    const result = await db.transaction(async (tx) => {
      if ((await partnerCount(tx, user.id)) > 0) return { partnerId: null };
      const [row] = await tx.execute<{ id: string | null }>(sql`select app_open_phone_invitation(${phone}) as id`);
      if (!row?.id) throw new LoginAccessError("no_login");
      return { partnerId: await acceptInvitation(tx, row.id, user.id, phone) };
    });
    // First link: nothing but this session may carry the new partner access.
    if (result.partnerId) await deps.endOtherSessions().catch(() => {});
    return result;
  } catch (err) {
    await deps.signOut().catch(() => {});
    throw err;
  }
}
