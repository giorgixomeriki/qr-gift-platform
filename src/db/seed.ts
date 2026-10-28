import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { createClient } from "@supabase/supabase-js";
import { contentTypes, themes, products, prices } from "./schema";
import { MAX_MEDIA_BYTES } from "../lib/validation/content-types";

async function ensureStorageBucket() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucketName = process.env.SUPABASE_STORAGE_BUCKET ?? "greeting-media";
  if (!supabaseUrl || !serviceRoleKey) {
    console.warn("Skipping storage bucket setup: Supabase env vars not set.");
    return;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const settings = {
    public: false, // private: all reads/writes go through signed URLs we issue server-side
    // The app's own largest per-type limit (lib/validation/content-types.ts),
    // within Supabase Free's 50 MB per-file cap.
    fileSizeLimit: MAX_MEDIA_BYTES,
  };
  const { data: existing } = await supabase.storage.getBucket(bucketName);
  if (existing) {
    if (existing.public || existing.file_size_limit !== MAX_MEDIA_BYTES) {
      // Re-aligns a bucket created by an older seed (100MB). Also forces it
      // private: a public bucket would bypass the signed-URL model.
      const { error } = await supabase.storage.updateBucket(bucketName, settings);
      if (error) throw error;
      console.log(`Storage bucket "${bucketName}" aligned: private, ${MAX_MEDIA_BYTES} bytes per file.`);
    } else {
      console.log(`Storage bucket "${bucketName}" already exists.`);
    }
    return;
  }

  const { error } = await supabase.storage.createBucket(bucketName, settings);
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
      { key: "wedding", name: "Wedding", config: { palette: "ivory-sage", reveal: "envelope" } },
      { key: "celebration", name: "Celebration", config: { palette: "midnight-stars", reveal: "balloon" } },
      { key: "elegant", name: "Elegant", config: { palette: "noir-gold", reveal: "fade" } },
      { key: "luxury-vintage", name: "Luxury Vintage", config: { palette: "parchment-gold", reveal: "envelope" } },
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
    // Launch price: 10.00 GEL. Seed data only — prices are rows, and an
    // order snapshots its own amount, so this never reprices an existing order.
    PREMIUM_GREETING: 1000,
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
