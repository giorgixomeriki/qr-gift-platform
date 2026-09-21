import "server-only";
import { z } from "zod";

/**
 * Single validated source of truth for SERVER-SIDE environment variables,
 * including secrets. The "server-only" import makes Next.js fail the build if
 * any client component ever imports this module. Client components that need
 * a NEXT_PUBLIC_* value must import from lib/env.public.ts instead.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Runtime app connection — a restricted, non-superuser Postgres role that RLS
  // policies actually apply to. Never the Supabase/postgres superuser role.
  DATABASE_URL: z.string().min(1),

  // Superuser connection used ONLY by drizzle-kit migrations (schema DDL, role
  // creation, policy creation). Never imported by application runtime code.
  MIGRATIONS_DATABASE_URL: z.string().min(1).optional(),

  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  // Server-only. Bypasses RLS — used exclusively for signed Storage URL issuance
  // after the app has already validated ownership in code. Never sent to the client.
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_STORAGE_BUCKET: z.string().min(1).default("greeting-media"),

  // HMAC key for hashing sender edit tokens before they're stored. See
  // lib/security/edit-token.ts.
  EDIT_TOKEN_SECRET: z.string().min(16),

  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),

  // Which PaymentProvider to construct (lib/payments/provider-factory.ts).
  // "TEST" is refused at startup when NODE_ENV=production — see that file.
  // "BOG" is a placeholder adapter (providers/bog-provider.ts) whose methods
  // are not implemented — selecting it does not mean BOG is integrated.
  PAYMENTS_PROVIDER: z.enum(["TEST", "BOG"]).default("TEST"),

  // Real-provider credentials — all optional at the schema level (TEST mode
  // needs none of them), but superRefine below requires every one of them
  // the instant PAYMENTS_PROVIDER=BOG, so a half-configured real provider
  // fails at startup with a specific message rather than at first checkout
  // attempt, and never silently behaves like TEST.
  BOG_CLIENT_ID: z.string().min(1).optional(),
  BOG_CLIENT_SECRET: z.string().min(1).optional(),
  BOG_API_BASE_URL: z.string().url().optional(),
  BOG_WEBHOOK_SIGNING_KEY: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables — see log above.");
  }

  const data = parsed.data;
  if (data.PAYMENTS_PROVIDER === "BOG") {
    const required = {
      BOG_CLIENT_ID: data.BOG_CLIENT_ID,
      BOG_CLIENT_SECRET: data.BOG_CLIENT_SECRET,
      BOG_API_BASE_URL: data.BOG_API_BASE_URL,
      BOG_WEBHOOK_SIGNING_KEY: data.BOG_WEBHOOK_SIGNING_KEY,
    };
    const missing = Object.entries(required)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (missing.length > 0) {
      throw new Error(
        `PAYMENTS_PROVIDER=BOG requires ${missing.join(", ")} to be set. ` +
          "Configuration must fail closed here rather than fall back to TEST.",
      );
    }
  }

  return data;
}

export const env = loadEnv();
