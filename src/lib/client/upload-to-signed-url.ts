"use client";

import { publicEnv } from "@/lib/env.public";

/**
 * Direct-to-Storage upload against a Supabase signed upload URL, replicating
 * (byte-for-byte, per @supabase/storage-js's uploadToSignedUrl) the exact
 * request shape Storage expects: PUT, multipart/form-data with a
 * `cacheControl` field and the file under an empty field name. Done as a raw
 * XHR — rather than the SDK helper — solely to get real `progress` events,
 * which the SDK does not expose. The `apikey`/`Authorization` headers here
 * are the public anon key (safe in the browser); the actual authorization to
 * write THIS object comes from the one-time `token` already embedded in
 * `uploadUrl` by the server (lib/storage/media.ts's createSignedUploadUrl).
 */
export function uploadToSignedUrl(uploadUrl: string, file: File | Blob, onProgress?: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("apikey", publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    xhr.setRequestHeader("Authorization", `Bearer ${publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY}`);
    xhr.setRequestHeader("x-upsert", "false");

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Upload failed — check your connection"));

    const form = new FormData();
    form.append("cacheControl", "3600");
    form.append("", file);
    xhr.send(form);
  });
}
