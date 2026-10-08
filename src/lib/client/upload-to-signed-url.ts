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
/** No upload progress for this long means the connection is gone (a phone switching networks often leaves the request hanging rather than failing). */
const STALL_MS = 30_000;

export class UploadAbortedError extends Error {
  constructor() {
    super("Upload cancelled");
  }
}

export function uploadToSignedUrl(
  uploadUrl: string,
  file: File | Blob,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new UploadAbortedError());
    const xhr = new XMLHttpRequest();
    let stall = 0;
    const armStall = () => {
      window.clearTimeout(stall);
      stall = window.setTimeout(() => xhr.abort(), STALL_MS);
    };
    const settle = () => {
      window.clearTimeout(stall);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => xhr.abort();
    signal?.addEventListener("abort", onAbort);
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("apikey", publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    xhr.setRequestHeader("Authorization", `Bearer ${publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY}`);
    xhr.setRequestHeader("x-upsert", "false");

    xhr.upload.onprogress = (event) => {
      armStall();
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      settle();
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => {
      settle();
      reject(new Error("Upload failed — check your connection"));
    };
    xhr.onabort = () => {
      settle();
      reject(signal?.aborted ? new UploadAbortedError() : new Error("Upload stalled — check your connection"));
    };
    armStall();

    const form = new FormData();
    form.append("cacheControl", "3600");
    form.append("", file);
    xhr.send(form);
  });
}
