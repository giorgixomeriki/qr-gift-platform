import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

async function main() {
  // Runs with the superuser connection on purpose: this is the only place in
  // the codebase allowed to CREATE ROLE / ENABLE ROW LEVEL SECURITY / CREATE
  // POLICY. Application runtime code must never import MIGRATIONS_DATABASE_URL
  // — see src/db/client.ts and src/lib/env.ts.
  const url = process.env.MIGRATIONS_DATABASE_URL;
  if (!url) {
    throw new Error("MIGRATIONS_DATABASE_URL is required to run migrations");
  }

  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: "./src/db/migrations" });
  await sql.end();
  console.log("Migrations applied.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
