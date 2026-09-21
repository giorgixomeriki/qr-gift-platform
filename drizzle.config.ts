import { defineConfig } from "drizzle-kit";

// Migrations run against the Postgres superuser connection (needed to CREATE ROLE,
// ENABLE ROW LEVEL SECURITY, etc). The app's runtime queries use a separate,
// privilege-restricted role — see src/db/client.ts and env.ts.
const url = process.env.MIGRATIONS_DATABASE_URL;
if (!url) {
  throw new Error("MIGRATIONS_DATABASE_URL is required to run drizzle-kit");
}

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
