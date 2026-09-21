"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSessionUser } from "./session";
import { getPartnerRole } from "@/db/client";
import { ACTIVE_PARTNER_COOKIE } from "./partner-context";
import { env } from "@/lib/env";

export async function signOutAction(redirectTo: string) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect(redirectTo);
}

/**
 * Switches which partner the session operates against. Re-verifies
 * membership server-side before setting the cookie — the cookie is only ever
 * a hint about which partner to check next (requirePartnerContext
 * re-verifies again on every mutation), never proof of access by itself.
 */
export async function setActivePartnerAction(partnerId: string) {
  const user = await getSessionUser();
  if (!user) throw new Error("Not signed in");

  const role = await getPartnerRole(user.id, partnerId);
  if (!role) throw new Error("Not a member of this partner");

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_PARTNER_COOKIE, partnerId, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 90,
  });
  revalidatePath("/partner/dashboard");
}
