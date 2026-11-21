import "server-only";
import { createClient, type User } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { publicEnv } from "@/lib/env.public";
import { fromAuthPhone, toAuthPhone } from "@/lib/partners/contact";

/**
 * The Supabase Auth admin operations partner login access needs, behind one
 * small interface so the rules in lib/partners/login-access.ts can be tested
 * with the real local Auth server or a stand-in. Uses the secret key: server
 * only, never imported by client code.
 */
export type AuthUserSummary = {
  id: string;
  email: string | null;
  emailConfirmed: boolean;
  /** E.164 (+995…), or null. */
  phone: string | null;
  phoneConfirmed: boolean;
  banned: boolean;
  lastSignInAt: string | null;
};

export interface AuthDirectory {
  findByEmail(email: string): Promise<AuthUserSummary | null>;
  findByPhone(phoneE164: string): Promise<AuthUserSummary | null>;
  getById(userId: string): Promise<AuthUserSummary | null>;
  /** Email already proven (the person holds a link sent to it). */
  createEmailUser(email: string, password: string): Promise<AuthUserSummary>;
  /** Unconfirmed until the person verifies an SMS code. */
  createPhoneUser(phoneE164: string): Promise<AuthUserSummary>;
  setPassword(userId: string, password: string, opts?: { confirmEmail?: boolean }): Promise<void>;
  setBanned(userId: string, banned: boolean): Promise<void>;
  deleteUser(userId: string): Promise<void>;
}

export class AuthDirectoryError extends Error {
  /** Supabase Auth error code, e.g. "weak_password" (never contains the password). */
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

const BAN_DURATION = "876000h"; // ~100 years: "until an admin restores it".

function summarize(user: User): AuthUserSummary {
  const bannedUntil = (user as User & { banned_until?: string | null }).banned_until;
  return {
    id: user.id,
    email: user.email ? user.email.toLowerCase() : null,
    emailConfirmed: Boolean(user.email_confirmed_at),
    phone: fromAuthPhone(user.phone),
    phoneConfirmed: Boolean(user.phone_confirmed_at),
    banned: Boolean(bannedUntil && new Date(bannedUntil).getTime() > Date.now()),
    lastSignInAt: user.last_sign_in_at ?? null,
  };
}

export function createSupabaseAuthDirectory(): AuthDirectory {
  const client = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Same bounded full scan as lib/auth/admin-users.ts (audit F-03): Auth has
  // no lookup by email/phone in its admin API.
  async function scan(match: (u: User) => boolean): Promise<User | null> {
    const perPage = 200;
    for (let page = 1; page <= 200; page++) {
      const { data, error } = await client.auth.admin.listUsers({ page, perPage });
      if (error) throw new AuthDirectoryError("Could not look up accounts");
      const hit = data.users.find(match);
      if (hit) return hit;
      if (data.users.length < perPage) return null;
    }
    throw new AuthDirectoryError("Account lookup exceeded its bound");
  }

  return {
    async findByEmail(email) {
      const lower = email.toLowerCase();
      const user = await scan((u) => u.email?.toLowerCase() === lower);
      return user ? summarize(user) : null;
    },
    async findByPhone(phoneE164) {
      const user = await scan((u) => fromAuthPhone(u.phone) === phoneE164);
      return user ? summarize(user) : null;
    },
    async getById(userId) {
      const { data, error } = await client.auth.admin.getUserById(userId);
      if (error || !data.user) return null;
      return summarize(data.user);
    },
    async createEmailUser(email, password) {
      const { data, error } = await client.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data.user) throw new AuthDirectoryError(`Could not create the account${error?.code ? ` (${error.code})` : ""}`, error?.code);
      return summarize(data.user);
    },
    async createPhoneUser(phoneE164) {
      const { data, error } = await client.auth.admin.createUser({ phone: toAuthPhone(phoneE164), phone_confirm: false });
      if (error || !data.user) throw new AuthDirectoryError(`Could not create the account${error?.code ? ` (${error.code})` : ""}`);
      return summarize(data.user);
    },
    async setPassword(userId, password, opts) {
      const { error } = await client.auth.admin.updateUserById(userId, {
        password,
        ...(opts?.confirmEmail ? { email_confirm: true } : {}),
      });
      if (error) throw new AuthDirectoryError(`Could not set the password${error.code ? ` (${error.code})` : ""}`, error.code);
    },
    async setBanned(userId, banned) {
      const { error } = await client.auth.admin.updateUserById(userId, { ban_duration: banned ? BAN_DURATION : "none" });
      if (error) throw new AuthDirectoryError("Could not change the account's access");
    },
    async deleteUser(userId) {
      const { error } = await client.auth.admin.deleteUser(userId);
      if (error) throw new AuthDirectoryError("Could not delete the account");
    },
  };
}

let directory: AuthDirectory | null = null;

/** The process-wide directory (lazily built so importing this costs nothing). */
export function authDirectory(): AuthDirectory {
  directory ??= createSupabaseAuthDirectory();
  return directory;
}
