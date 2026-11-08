import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { publicEnv } from "@/lib/env.public";

/**
 * Writes the server-side half of admin MFA (see lib/auth/assurance.ts). Uses
 * the secret key because app_metadata is exactly what a user session cannot
 * change. Never imported from client code.
 */
const authAdminClient = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type StoredPolicy = { enrollment_until: string | null; factor_ids: string[] };

export async function updateAdminMfaPolicy(userId: string, change: (current: StoredPolicy) => StoredPolicy): Promise<void> {
  const { data, error } = await authAdminClient.auth.admin.getUserById(userId);
  if (error) throw error;
  const raw = (data.user.app_metadata as { admin_mfa?: Partial<StoredPolicy> }).admin_mfa;
  const current: StoredPolicy = { enrollment_until: raw?.enrollment_until ?? null, factor_ids: Array.isArray(raw?.factor_ids) ? raw.factor_ids : [] };
  const { error: updateError } = await authAdminClient.auth.admin.updateUserById(userId, { app_metadata: { admin_mfa: change(current) } });
  if (updateError) throw updateError;
}
