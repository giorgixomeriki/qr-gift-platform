import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { createClient } from "@supabase/supabase-js";
import { contentTypes, themes, products, prices } from "./schema";

async function ensureStorageBucket() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucketName = process.env.SUPABASE_STORAGE_BUCKET ?? "greeting-media";
  if (!supabaseUrl || !serviceRoleKey) {
    console.warn("Skipping storage bucket setup: Supabase env vars not set.");
    return;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: existing } = await supabase.storage.getBucket(bucketName);
  if (existing) {
    console.log(`Storage bucket "${bucketName}" already exists.`);
    return;
  }

  const { error } = await supabase.storage.createBucket(bucketName, {
    public: false, // private: all reads/writes go through signed URLs we issue server-side
    fileSizeLimit: "100MB",
  });
  if (error) throw error;
  console.log(`Created private storage bucket "${bucketName}".`);
}

async function main() {
  await ensureStorageBucket();

  // Reference/config data bootstrap. Runs with the superuser connection (like
  // migrations) since RLS restricts writes to these tables to app_is_admin() —
  // there is no admin session during a local seed run.
  const url = process.env.MIGRATIONS_DATABASE_URL;
  if (!url) {
    throw new Error("MIGRATIONS_DATABASE_URL is required to run the seed script");
  }

  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql);

  await db
    .insert(contentTypes)
    .values([
      { key: "text", category: "text" },
      { key: "photo", category: "media" },
      { key: "video", category: "media" },
      { key: "audio", category: "media" },
    ])
    .onConflictDoNothing();

  await db
    .insert(themes)
    .values([
      { key: "romantic", name: "Romantic", config: { palette: "rose-dusk", reveal: "envelope" } },
      { key: "birthday", name: "Birthday", config: { palette: "warm-confetti", reveal: "balloon" } },
      { key: "minimal", name: "Minimal", config: { palette: "mono", reveal: "fade" } },
    ])
    .onConflictDoNothing();

  const insertedProducts = await db
    .insert(products)
    .values([
      { key: "PHOTO_GREETING", name: "Photo Greeting" },
      { key: "VIDEO_GREETING", name: "Video Greeting" },
      { key: "PREMIUM_GREETING", name: "Premium Greeting" },
      { key: "GROUP_GREETING", name: "Group Greeting" },
    ])
    .onConflictDoNothing()
    .returning({ id: products.id, key: products.key });

  const defaultPricesMinor: Record<string, number> = {
    PHOTO_GREETING: 500,
    VIDEO_GREETING: 1000,
    PREMIUM_GREETING: 1500,
    GROUP_GREETING: 2000,
  };

  if (insertedProducts.length > 0) {
    await db
      .insert(prices)
      .values(
        insertedProducts.map((p) => ({
          productId: p.id,
          partnerId: null,
          currency: "GEL",
          amountMinor: defaultPricesMinor[p.key] ?? 500,
        })),
      )
      .onConflictDoNothing();
  }

  await sql.end();
  console.log("Seed complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
