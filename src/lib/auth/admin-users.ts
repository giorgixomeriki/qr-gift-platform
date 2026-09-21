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
 * listUsers() is unpaginated here deliberately — fine for a single pilot's
 * user count, and avoids inventing a search-by-email API call that may or
 * may not exist across supabase-js versions; revisit if the user base grows
 * enough that scanning the full list becomes slow.
 */
export async function resolveOrInviteUserByEmail(email: string): Promise<{ userId: string; invited: boolean }> {
  const { data: list, error: listError } = await authAdminClient.auth.admin.listUsers();
  if (listError) throw new UserResolutionError(`Could not look up existing users: ${listError.message}`);

  const existing = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (existing) return { userId: existing.id, invited: false };

  const { data, error } = await authAdminClient.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${publicEnv.NEXT_PUBLIC_APP_URL}/partner/login`,
  });
  if (error || !data.user) {
    throw new UserResolutionError(`Could not invite ${email}: ${error?.message ?? "unknown error"}`);
  }
  return { userId: data.user.id, invited: true };
}
