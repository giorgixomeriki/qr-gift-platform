import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Service-role Supabase client — bypasses Storage policies entirely. This is
 * intentional and safe ONLY because every function below independently
 * verifies ownership in application code (via Drizzle/RLS-scoped queries)
 * BEFORE ever calling into Storage. Never accept a client-supplied storage key
 * for signing without that check — see architecture plan §9.
 */
const storageClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const bucket = env.SUPABASE_STORAGE_BUCKET;

/** partners/{partnerId}/greetings/{greetingId}/{contentId}.{ext} — see architecture plan §10. */
export function buildStorageKey(params: {
  partnerId: string;
  greetingId: string;
  contentId: string;
  extension: string;
}): string {
  const ext = params.extension.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return `partners/${params.partnerId}/greetings/${params.greetingId}/${params.contentId}.${ext}`;
}

const UPLOAD_URL_TTL_SECONDS = 60 * 5;
const READ_URL_TTL_SECONDS = 60 * 10;

/**
 * Issues a short-lived signed upload URL for a storage key the caller has
 * already constructed via buildStorageKey() for a content row it owns. This
 * function does not itself check ownership — callers (the content
 * start/finalize route handlers, built in Phase 4) must resolve and verify the
 * greeting_content row first, then pass the derived key in.
 */
export async function createSignedUploadUrl(storageKey: string) {
  const { data, error } = await storageClient.storage
    .from(bucket)
    .createSignedUploadUrl(storageKey, { upsert: false });
  if (error) throw error;
  return { ...data, expiresInSeconds: UPLOAD_URL_TTL_SECONDS };
}

/** Short-lived signed read URL — re-signed on every view, never a permanent public URL. */
export async function createSignedReadUrl(storageKey: string) {
  const { data, error } = await storageClient.storage
    .from(bucket)
    .createSignedUrl(storageKey, READ_URL_TTL_SECONDS);
  if (error) throw error;
  return data.signedUrl;
}

export async function deleteStorageObject(storageKey: string) {
  const { error } = await storageClient.storage.from(bucket).remove([storageKey]);
  if (error) throw error;
}
