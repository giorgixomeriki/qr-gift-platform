"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { requestUploadAction, finalizeUploadAction, deleteContentAction } from "@/lib/greetings/actions";
import { normalisePhoto } from "@/lib/client/normalise-photo";
import { uploadToSignedUrl, UploadAbortedError } from "@/lib/client/upload-to-signed-url";
import { allowedMimeTypesFor, sizeLimitFor } from "@/lib/validation/content-types";
import type { GreetingRenderContent } from "./greeting-renderer";

export type MediaKind = "photo" | "video" | "audio";

/** Server slot limits (src/lib/greetings/content.ts SLOT_LIMITS — the server enforces them; this only shapes the UI). */
export const SLOT_LIMITS: Record<MediaKind, number> = { photo: 3, video: 1, audio: 1 };

/** A removed attachment can be restored for this long before it is deleted on the server. */
export const UNDO_MS = 5000;

export type MediaItem = {
  key: string;
  kind: MediaKind;
  slot: number;
  /**
   * preparing — on-device work before any byte is sent (a 12 MP photo is decoded, rotated, re-encoded)
   * uploading — the signed PUT, with real progress
   * failed — the transfer or the server's check failed; the file is kept, Retry is one tap
   * invalid — the file can't be sent at all (type, size): the row says why and offers Remove only
   * done — saved: the server has verified and committed it
   */
  status: "preparing" | "uploading" | "failed" | "invalid" | "done";
  progress: number;
  /** What the thumbnail shows: the signed URL once saved, the local file while it uploads. */
  url: string | null;
  contentId: string | null;
  body?: Blob;
  error?: string;
  durationMs?: number | null;
  /** Removed by the sender, but not yet deleted on the server: Undo restores it. */
  removedAt?: number;
};

type Existing = { contentId: string; url: string } | null;

let keySeq = 0;
const nextKey = () => `m${++keySeq}`;

/**
 * The greeting's attachments and their uploads, held above the wizard's
 * screens so Back / forward keep them and an upload keeps running while the
 * sender looks at another step. Every transfer goes through the real
 * pipeline — requestUploadAction (server-validated type, size and slot) →
 * signed PUT to private Storage (progress, cancel, stall detection) →
 * finalizeUploadAction (magic-byte check, atomic commit) — never a mock.
 *
 * Remove is delayed by UNDO_MS so it can be undone. The delayed delete is
 * safe because the item stays a normal, private, server-side attachment
 * until the delete runs: nothing is orphaned (the row and its file go
 * together through deleteContentAction), and leaving Create flushes every
 * pending removal first (flushRemovals) so Preview and checkout never see
 * something the sender removed. If the tab closes inside the window the
 * delete never runs — the attachment simply stays, visible on return.
 */
export function useMediaUploads(greetingId: string, initial: { photos: Existing[]; video: Existing; audio: Existing }) {
  const t = useTranslations("wizard.media");
  const ts = useTranslations("wizard.sig");
  const [items, setItems] = useState<MediaItem[]>(() => {
    const list: MediaItem[] = [];
    initial.photos.forEach((p, slot) => p && list.push({ key: nextKey(), kind: "photo", slot, status: "done", progress: 1, url: p.url, contentId: p.contentId }));
    if (initial.video) list.push({ key: nextKey(), kind: "video", slot: 0, status: "done", progress: 1, url: initial.video.url, contentId: initial.video.contentId });
    if (initial.audio) list.push({ key: nextKey(), kind: "audio", slot: 0, status: "done", progress: 1, url: initial.audio.url, contentId: initial.audio.contentId });
    return list;
  });
  const [removeError, setRemoveError] = useState(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  /** Per item: the current attempt (a stale response from an earlier attempt is ignored) and its transfer. */
  const attempts = useRef(new Map<string, number>());
  const controllers = useRef(new Map<string, AbortController>());
  const removalTimers = useRef(new Map<string, number>());
  const localUrls = useRef(new Set<string>());

  const update = useCallback((key: string, patch: Partial<MediaItem>) => setItems((list) => list.map((m) => (m.key === key ? { ...m, ...patch } : m))), []);
  const drop = useCallback((key: string) => setItems((list) => list.filter((m) => m.key !== key)), []);
  const isCurrent = (key: string, attempt: number) => attempts.current.get(key) === attempt && itemsRef.current.some((m) => m.key === key);

  useEffect(
    () => () => {
      controllers.current.forEach((c) => c.abort());
      removalTimers.current.forEach((id) => window.clearTimeout(id));
      localUrls.current.forEach((u) => URL.revokeObjectURL(u));
    },
    [],
  );

  const localUrl = (blob: Blob) => {
    const u = URL.createObjectURL(blob);
    localUrls.current.add(u);
    return u;
  };

  /** The transfer itself, for a new item or a retry. */
  const transfer = useCallback(
    async (key: string, kind: MediaKind, slot: number, body: Blob) => {
      const attempt = (attempts.current.get(key) ?? 0) + 1;
      attempts.current.set(key, attempt);
      update(key, { status: "uploading", progress: 0, error: undefined });
      let reserved: string | null = null;
      // Any failure after the reservation releases it (row + any partial object), so a retry starts clean.
      const fail = () => {
        if (reserved) void deleteContentAction(greetingId, reserved).catch(() => null);
        if (isCurrent(key, attempt)) update(key, { status: "failed", body });
      };

      const requested = await requestUploadAction(greetingId, { type: kind, slot, mimeType: body.type, sizeBytes: body.size }).catch(() => null);
      if (!requested?.ok) {
        if (requested) console.error("[requestUpload]", requested.error);
        return fail();
      }
      reserved = requested.data.contentId;
      // Cancelled before the transfer began: release the reservation.
      if (!isCurrent(key, attempt)) return void deleteContentAction(greetingId, reserved).catch(() => null);

      const controller = new AbortController();
      controllers.current.set(key, controller);
      try {
        await uploadToSignedUrl(requested.data.uploadUrl, body, (fraction) => isCurrent(key, attempt) && update(key, { progress: fraction }), controller.signal);
      } catch (err) {
        if (controllers.current.get(key) === controller) controllers.current.delete(key);
        if (err instanceof UploadAbortedError) return void deleteContentAction(greetingId, reserved).catch(() => null);
        return fail();
      }
      if (controllers.current.get(key) === controller) controllers.current.delete(key);
      if (!isCurrent(key, attempt)) return void deleteContentAction(greetingId, reserved).catch(() => null);

      const finalized = await finalizeUploadAction(greetingId, reserved).catch(() => null);
      if (!finalized?.ok) {
        if (finalized) console.error("[finalizeUpload]", finalized.error);
        return fail();
      }
      if (!isCurrent(key, attempt)) return void deleteContentAction(greetingId, reserved).catch(() => null);
      update(key, { status: "done", progress: 1, contentId: reserved, url: finalized.data.signedUrl, body: undefined });
    },
    [greetingId, update],
  );

  /** Deletes a removed item on the server now. Restores it (with a notice) if that fails. */
  const commitRemoval = useCallback(
    async (key: string) => {
      window.clearTimeout(removalTimers.current.get(key));
      removalTimers.current.delete(key);
      const item = itemsRef.current.find((m) => m.key === key);
      if (!item || item.removedAt === undefined) return true;
      if (!item.contentId) {
        drop(key);
        return true;
      }
      const result = await deleteContentAction(greetingId, item.contentId).catch(() => null);
      if (!result?.ok) {
        if (result) console.error("[deleteContent]", result.error);
        update(key, { removedAt: undefined });
        setRemoveError(true);
        return false;
      }
      drop(key);
      return true;
    },
    [greetingId, drop, update],
  );

  /** Every pending removal, deleted now — before Preview, checkout or another step reads the greeting. */
  const flushRemovals = useCallback(async () => {
    const pending = itemsRef.current.filter((m) => m.removedAt !== undefined).map((m) => m.key);
    const results = await Promise.all(pending.map((k) => commitRemoval(k)));
    return results.every(Boolean);
  }, [commitRemoval]);

  /** Adds a file (or a recording) as a new attachment of `kind` in the first free slot. */
  const add = useCallback(
    async (kind: MediaKind, file: Blob, opts: { durationMs?: number | null } = {}) => {
      setRemoveError(false);
      let used = new Set(itemsRef.current.filter((m) => m.kind === kind).map((m) => m.slot));
      let slot = [...Array(SLOT_LIMITS[kind]).keys()].find((s) => !used.has(s));
      if (slot === undefined) {
        // Every slot is taken, one by an item waiting out its Undo: delete it now and use its slot.
        const waiting = itemsRef.current.find((m) => m.kind === kind && m.removedAt !== undefined);
        if (!waiting || !(await commitRemoval(waiting.key))) return;
        used = new Set(itemsRef.current.filter((m) => m.kind === kind && m.key !== waiting.key).map((m) => m.slot));
        slot = [...Array(SLOT_LIMITS[kind]).keys()].find((s) => !used.has(s));
        if (slot === undefined) return;
      }
      const key = nextKey();
      const item: MediaItem = { key, kind, slot, status: "preparing", progress: 0, url: kind === "audio" ? null : localUrl(file), contentId: null, durationMs: opts.durationMs ?? null };
      itemsRef.current = [...itemsRef.current, item];
      setItems((list) => [...list, item]);
      attempts.current.set(key, 0);

      const body = kind === "photo" && file instanceof File ? await normalisePhoto(file) : file;
      if (!itemsRef.current.some((m) => m.key === key)) return; // cancelled while preparing
      const allowed = allowedMimeTypesFor(kind);
      const type = body.type.split(";")[0]!.trim();
      if (!allowed.includes(type)) {
        update(key, { status: "invalid", error: t("errorType", { types: allowed.map((m) => m.split("/")[1]).join(", ") }) });
        return;
      }
      if (body.size > sizeLimitFor(kind)) {
        update(key, { status: "invalid", error: t("errorSize", { limit: Math.round(sizeLimitFor(kind) / (1024 * 1024)) }) });
        return;
      }
      const clean = type === body.type ? body : new Blob([body], { type });
      if (kind === "photo" && body !== file) update(key, { url: localUrl(clean) });
      await transfer(key, kind, slot, clean);
    },
    [commitRemoval, transfer, update, t],
  );

  const retry = useCallback(
    (key: string) => {
      const item = itemsRef.current.find((m) => m.key === key);
      if (!item?.body) return;
      void transfer(key, item.kind, item.slot, item.body);
    },
    [transfer],
  );

  /** Stops an upload in flight (or a file still being prepared): it is dropped; nothing was saved. */
  const cancel = useCallback(
    (key: string) => {
      attempts.current.set(key, (attempts.current.get(key) ?? 0) + 1);
      controllers.current.get(key)?.abort();
      controllers.current.delete(key);
      itemsRef.current = itemsRef.current.filter((m) => m.key !== key);
      drop(key);
    },
    [drop],
  );

  const remove = useCallback(
    (key: string) => {
      setRemoveError(false);
      const item = itemsRef.current.find((m) => m.key === key);
      if (!item) return;
      // Nothing on the server (a failed or invalid file): just let it go.
      if (item.status !== "done") return cancel(key);
      update(key, { removedAt: Date.now() });
      removalTimers.current.set(key, window.setTimeout(() => void commitRemoval(key), UNDO_MS));
    },
    [cancel, commitRemoval, update],
  );

  const undo = useCallback(
    (key: string) => {
      window.clearTimeout(removalTimers.current.get(key));
      removalTimers.current.delete(key);
      update(key, { removedAt: undefined });
    },
    [update],
  );

  const live = useMemo(() => items.filter((m) => m.removedAt === undefined), [items]);
  const uploading = live.filter((m) => m.status === "preparing" || m.status === "uploading").length;
  const failed = live.filter((m) => m.status === "failed" || m.status === "invalid").length;

  /** What Preview renders: saved attachments only, photos in slot order. */
  const content: Omit<GreetingRenderContent, "message"> = useMemo(() => {
    const saved = live.filter((m) => m.status === "done" && m.url && m.contentId);
    const one = (kind: MediaKind) => {
      const m = saved.find((x) => x.kind === kind);
      return m ? { url: m.url! } : null;
    };
    return {
      photos: saved
        .filter((m) => m.kind === "photo")
        .sort((a, b) => a.slot - b.slot)
        .map((m) => ({ id: m.contentId!, url: m.url! })),
      video: one("video"),
      audio: one("audio"),
    };
  }, [live]);

  /** A short, stable name for a row: "Photo 2", "Video", "Voice message". */
  const nameOf = useCallback(
    (m: MediaItem) => {
      if (m.kind === "photo") {
        const photos = items.filter((x) => x.kind === "photo").sort((a, b) => a.slot - b.slot);
        return ts("photoN", { n: photos.indexOf(m) + 1 });
      }
      return m.kind === "video" ? ts("videoLabel") : ts("voiceLabel");
    },
    [items, ts],
  );

  return { items, live, uploading, failed, content, add, retry, cancel, remove, undo, flushRemovals, nameOf, removeError };
}

export type MediaUploads = ReturnType<typeof useMediaUploads>;
