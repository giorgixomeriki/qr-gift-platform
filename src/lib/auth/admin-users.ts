import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { publicEnv } from "@/lib/env.public";

/**
 * Service-role Supabase Auth Admin client — same pattern as
 * lib/storage/media.ts's storageClient. Used ONLY to resolve an email to a
 * user id (or invite a brand-new one) for partner-membership management
 * (Phase 5 §13). Never imported from client code.
 */
const authAdminClient = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export class UserResolutionError extends Error {}

/**
 * Replaces "type a raw Supabase auth UUID" (Phase 5 §13's named pilot
 * blocker) with "type the person's email" — an admin/OWNER already knows a
 * teammate's email, never their internal user id. If that email already has
 * an account, its id is returned directly. If not, Supabase's own
 * `inviteUserByEmail` creates the account and emails them a sign-in link —
 * this is the one built-in capability already present in the auth stack
 * (Supabase Auth), not a new invitation system: no new table, no new email
 * templates, no token management of our own.
 *
 * Audit finding F-03: `listUsers()` is paginated by Supabase (50/page by
 * default) — a lookup that only ever reads page 1 silently stops finding
 * existing users once the project passes ~50 total Auth users, at which
 * point it would start re-inviting people who already have an account
 * instead of resolving to their existing id. This walks every page (bounded
 * by MAX_PAGES as a structural safety cap, not an expected real limit) until
 * a match is found or the list is exhausted.
 */
async function findExistingUserByEmail(email: string, pageSize: number) {
  const MAX_PAGES = 200; // 200 * pageSize users — far beyond any plausible pilot/near-term user base.
  const lowerEmail = email.toLowerCase();

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data: list, error: listError } = await authAdminClient.auth.admin.listUsers({ page, perPage: pageSize });
    if (listError) throw new UserResolutionError(`Could not look up existing users: ${listError.message}`);

    const match = list.users.find((u) => u.email?.toLowerCase() === lowerEmail);
    if (match) return match;

    // Fewer users than a full page means this was the last page — no need to
    // ask for a page that can only come back empty.
    if (list.users.length < pageSize) return null;
  }
  throw new UserResolutionError(`User lookup exceeded ${MAX_PAGES} pages — the Auth user base has grown beyond what this scan is bounded for`);
}

/**
 * @param pageSize Page size used while scanning for an existing user.
 * Production callers should leave this at its default; it's an explicit
 * parameter only so tests can force multi-page pagination cheaply without
 * seeding hundreds of fixture users.
 */
export async function resolveOrInviteUserByEmail(email: string, pageSize = 200): Promise<{ userId: string; invited: boolean }> {
  const existing = await findExistingUserByEmail(email, pageSize);
  if (existing) return { userId: existing.id, invited: false };

  const { data, error } = await authAdminClient.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${publicEnv.NEXT_PUBLIC_APP_URL}/partner/login`,
  });
  if (error || !data.user) {
    throw new UserResolutionError(`Could not invite ${email}: ${error?.message ?? "unknown error"}`);
  }
  return { userId: data.user.id, invited: true };
}
