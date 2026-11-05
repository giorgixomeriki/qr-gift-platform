import { z } from "zod";
import { appUrlProblems, isHostedEnvironment } from "./env-guards";

/**
 * The subset of env vars safe to import from client components (only
 * NEXT_PUBLIC_* values, which Next.js inlines into the browser bundle anyway).
 * Deliberately has no "server-only" import and no secrets — see lib/env.ts for
 * the full server-side schema, which must never be imported from client code.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
});

// Production must name its own origin explicitly — it is baked into printed QR
// codes — rather than inherit the localhost default (lib/env-guards.ts).
const appUrlIssues = appUrlProblems(process.env.NEXT_PUBLIC_APP_URL, {
  production: process.env.NODE_ENV === "production",
  hosted: isHostedEnvironment(process.env),
});
if (appUrlIssues.length > 0) {
  throw new Error(`Unsafe environment configuration:\n- ${appUrlIssues.join("\n- ")}`);
}

export const publicEnv = publicEnvSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});
