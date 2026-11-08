import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Aal } from "./assurance";

export type SessionUser = { id: string; email: string | null };

/** Verified Supabase session user, or null. Never trust a client-supplied user id. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { id: user.id, email: user.email ?? null };
}

export type VerifiedFactor = { id: string; friendlyName: string | null; createdAt: string };
export type SessionAssurance = { user: SessionUser; aal: Aal; factors: VerifiedFactor[] };

/**
 * The session plus how strongly it was authenticated. `getUser()` asks the
 * Auth server (so a revoked session or deleted user fails here, and the factor
 * list is current); `getClaims()` verifies the JWT and is where `aal` comes
 * from. Reading `aal` from an unverified token would let an edited cookie
 * claim aal2. A token whose subject differs from the verified user counts as
 * no assurance at all.
 */
export async function getSessionAssurance(): Promise<SessionAssurance | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase.auth.getClaims();
  const claimed = data?.claims.sub === user.id ? data.claims.aal : null;
  const aal: Aal = claimed === "aal1" ? "aal1" : claimed === "aal2" ? "aal2" : null;
  const factors = (user.factors ?? [])
    .filter((f) => f.factor_type === "totp" && f.status === "verified")
    .map((f) => ({ id: f.id, friendlyName: f.friendly_name ?? null, createdAt: f.created_at }));

  return { user: { id: user.id, email: user.email ?? null }, aal, factors };
}
