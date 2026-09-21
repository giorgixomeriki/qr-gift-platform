import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { env } from "@/lib/env";

/**
 * Supabase client for Server Components/Route Handlers, used ONLY for auth
 * (session lookup, sign-in/out) — never for querying app data. All app data
 * access goes through src/db/client.ts (Drizzle + RLS), not through Supabase's
 * PostgREST layer, so tenant isolation is enforced in one place.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component during render, where cookies can't
          // be mutated — safe to ignore because middleware refreshes sessions.
        }
      },
    },
  });
}
