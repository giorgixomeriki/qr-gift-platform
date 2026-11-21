"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Camera, CameraOff, Check, ChevronLeft, List, RefreshCw, SwitchCamera, X } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Panel, control, fieldLabel } from "@/components/dashboard/ui";
import { parseScannedQr, tokenHint } from "@/lib/qr/scan-parse";
import { adminCreateHandoverAction, adminResolveScannedCardAction, type HandoverActionError } from "@/lib/qr/handover-actions";
import type { CardEligibility, IneligibleReason } from "@/lib/qr/handovers";

/**
 * Mobile-first continuous scanner for physical QR STARR cards (Scan-to-
 * Assign). The camera stays on between cards; each new QR is parsed locally
 * (a foreign QR never reaches the server), resolved once per session by an
 * authenticated server action, and kept in a selection that survives
 * navigation (sessionStorage). The server re-checks every card again when the
 * handover is submitted — nothing decided here is trusted.
 *
 * Decoding: the native BarcodeDetector where it exists (Chrome on Android),
 * otherwise jsQR (iPhone Safari), loaded only when needed.
 */

type Partner = { id: string; name: string };
type Selected = { token: string; hint: string };
type Rejected = { token: string; hint: string; reason: IneligibleReason; partnerName?: string };
type Feedback =
  | { kind: "added"; hint: string }
  | { kind: "duplicate"; hint: string }
  | { kind: "checking"; hint: string }
  | { kind: "network"; hint: string }
  | { kind: "scanError"; reason: "foreign" | "malformed" | "empty" }
  | { kind: "rejected"; hint: string; reason: IneligibleReason; partnerName?: string }
  | { kind: "actionError"; error: HandoverActionError };
type CameraState = "idle" | "starting" | "live" | "denied" | "unavailable" | "insecure" | "error";

const STORAGE_KEY = "qrstarr.scan-assign.v1";
const SAME_CODE_COOLDOWN_MS = 2500;
const SCAN_INTERVAL_MS = 120;

type Stored = { selected: Selected[]; target: number; partnerId: string; note: string; idempotencyKey: string };

function readStored(): Stored | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Stored>;
    if (!Array.isArray(v.selected)) return null;
    return {
      selected: v.selected.filter((s) => typeof s?.token === "string").map((s) => ({ token: s.token, hint: tokenHint(s.token) })),
      target: typeof v.target === "number" && v.target > 0 ? v.target : 20,
      partnerId: typeof v.partnerId === "string" ? v.partnerId : "",
      note: typeof v.note === "string" ? v.note : "",
      idempotencyKey: typeof v.idempotencyKey === "string" ? v.idempotencyKey : crypto.randomUUID(),
    };
  } catch {
    return null;
  }
}

function writeStored(v: Stored | null) {
  try {
    if (v) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(v));
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode / storage blocked: the selection just won't survive a reload.
  }
}

function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Not supported (iOS): visual feedback only.
  }
}

type Detector = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };

export function ScanAssign({ partners, appUrl, centralConfigured }: { partners: Partner[]; appUrl: string; centralConfigured: boolean }) {
  const t = useTranslations("handover");

  const [hydrated, setHydrated] = useState(false);
  const [phase, setPhase] = useState<"scan" | "review" | "done">("scan");
  const [selected, setSelected] = useState<Selected[]>([]);
  const [target, setTarget] = useState(20);
  const [partnerId, setPartnerId] = useState("");
  const [note, setNote] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [rejected, setRejected] = useState<Rejected[]>([]);
  const [pending, setPending] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [flash, setFlash] = useState<"ok" | "warn" | null>(null);
  const [showList, setShowList] = useState(false);
  const [manual, setManual] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reviewProblem, setReviewProblem] = useState<Rejected[] | HandoverActionError | null>(null);
  const [done, setDone] = useState<{ handoverId: string; quantity: number; partnerName: string; duplicate: boolean } | null>(null);

  const [camera, setCamera] = useState<CameraState>("idle");
  const [deviceIds, setDeviceIds] = useState<string[]>([]);
  const [deviceIndex, setDeviceIndex] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopRef = useRef<number | null>(null);
  const detectorRef = useRef<Detector | null>(null);
  const jsqrRef = useRef<typeof import("jsqr").default | null>(null);
  const lastCodeRef = useRef<{ value: string; at: number }>({ value: "", at: 0 });
  // Session cache: one server request per card per session.
  const resolvedRef = useRef<Map<string, CardEligibility>>(new Map());
  const inFlightRef = useRef<Set<string>>(new Set());
  const selectedRef = useRef<Selected[]>([]);
  selectedRef.current = selected;

  // Restore the selection after navigation / reload.
  useEffect(() => {
    const stored = readStored();
    if (stored) {
      setSelected(stored.selected);
      setTarget(stored.target);
      setPartnerId(stored.partnerId);
      setNote(stored.note);
      setIdempotencyKey(stored.idempotencyKey);
      for (const s of stored.selected) resolvedRef.current.set(s.token, { token: s.token, hint: s.hint, eligible: true });
    } else {
      setIdempotencyKey(crypto.randomUUID());
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || phase === "done") return;
    writeStored({ selected, target, partnerId, note, idempotencyKey });
  }, [hydrated, phase, selected, target, partnerId, note, idempotencyKey]);

  const signal = useCallback((fb: Feedback, tone: "ok" | "warn" | null) => {
    setFeedback(fb);
    if (tone) {
      setFlash(tone);
      window.setTimeout(() => setFlash(null), 450);
    }
    if (tone === "ok") vibrate(35);
    if (tone === "warn") vibrate([20, 60, 20]);
  }, []);

  const applyResult = useCallback(
    (card: CardEligibility) => {
      if (card.eligible) {
        if (!selectedRef.current.some((s) => s.token === card.token)) {
          setSelected((prev) => (prev.some((s) => s.token === card.token) ? prev : [...prev, { token: card.token, hint: card.hint }]));
        }
        signal({ kind: "added", hint: card.hint }, "ok");
      } else {
        setRejected((prev) => [{ token: card.token, hint: card.hint, reason: card.reason, partnerName: card.partnerName }, ...prev.filter((r) => r.token !== card.token)].slice(0, 5));
        signal({ kind: "rejected", hint: card.hint, reason: card.reason, partnerName: card.partnerName }, "warn");
      }
    },
    [signal],
  );

  const resolveToken = useCallback(
    async (token: string, raw: string) => {
      if (inFlightRef.current.has(token)) return;
      inFlightRef.current.add(token);
      try {
        const result = await adminResolveScannedCardAction(raw);
        if (result.ok) {
          resolvedRef.current.set(token, result.card);
          setPending((prev) => prev.filter((p) => p !== token));
          applyResult(result.card);
        } else {
          setPending((prev) => prev.filter((p) => p !== token));
          signal({ kind: "actionError", error: result.error }, "warn");
        }
      } catch {
        // Offline / dropped request: keep it queued and retry when back online.
        setPending((prev) => (prev.includes(token) ? prev : [...prev, token]));
        signal({ kind: "network", hint: tokenHint(token) }, "warn");
      } finally {
        inFlightRef.current.delete(token);
      }
    },
    [applyResult, signal],
  );

  const handleRaw = useCallback(
    (raw: string) => {
      const parsed = parseScannedQr(raw, appUrl);
      if (!parsed.ok) {
        signal({ kind: "scanError", reason: parsed.reason }, "warn");
        return;
      }
      const token = parsed.token;
      if (selectedRef.current.some((s) => s.token === token)) {
        signal({ kind: "duplicate", hint: tokenHint(token) }, null);
        vibrate(15);
        return;
      }
      const cached = resolvedRef.current.get(token);
      if (cached) {
        applyResult(cached);
        return;
      }
      signal({ kind: "checking", hint: tokenHint(token) }, null);
      void resolveToken(token, token);
    },
    [appUrl, applyResult, resolveToken, signal],
  );

  const retryPending = useCallback(() => {
    for (const token of pending) void resolveToken(token, token);
  }, [pending, resolveToken]);

  useEffect(() => {
    window.addEventListener("online", retryPending);
    return () => window.removeEventListener("online", retryPending);
  }, [retryPending]);

  // ---------------------------------------------------------------- camera
  const stopCamera = useCallback(() => {
    if (loopRef.current !== null) window.clearTimeout(loopRef.current);
    loopRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCamera((c) => (c === "live" || c === "starting" ? "idle" : c));
  }, []);

  const scanFrame = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !streamRef.current) return;
    if (video.readyState >= 2 && video.videoWidth > 0) {
      let value: string | null = null;
      try {
        if (detectorRef.current) {
          const codes = await detectorRef.current.detect(video);
          value = codes[0]?.rawValue ?? null;
        } else if (jsqrRef.current) {
          const scale = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight));
          const w = Math.round(video.videoWidth * scale);
          const h = Math.round(video.videoHeight * scale);
          const canvas = (canvasRef.current ??= document.createElement("canvas"));
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(video, 0, 0, w, h);
            const image = ctx.getImageData(0, 0, w, h);
            value = jsqrRef.current(image.data, w, h, { inversionAttempts: "dontInvert" })?.data ?? null;
          }
        }
      } catch {
        value = null;
      }
      if (value) {
        const now = Date.now();
        const last = lastCodeRef.current;
        if (value !== last.value || now - last.at > SAME_CODE_COOLDOWN_MS) handleRaw(value);
        lastCodeRef.current = { value, at: now };
      }
    }
    if (streamRef.current) loopRef.current = window.setTimeout(() => void scanFrame(), SCAN_INTERVAL_MS);
  }, [handleRaw]);

  const startCamera = useCallback(
    async (index = deviceIndex) => {
      if (!window.isSecureContext) return setCamera("insecure");
      if (!navigator.mediaDevices?.getUserMedia) return setCamera("unavailable");
      stopCamera();
      setCamera("starting");
      try {
        if (!detectorRef.current && !jsqrRef.current) {
          const BD = (window as unknown as { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector;
          const formats = BD?.getSupportedFormats ? await BD.getSupportedFormats().catch(() => [] as string[]) : [];
          if (BD && formats.includes("qr_code")) detectorRef.current = new BD({ formats: ["qr_code"] });
          else jsqrRef.current = (await import("jsqr")).default;
        }
        const deviceId = deviceIds[index];
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: deviceId
            ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
            : { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        // Labels / ids are only complete after permission is granted.
        const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput").map((d) => d.deviceId).filter(Boolean);
        if (devices.length) setDeviceIds(devices);
        setCamera("live");
        loopRef.current = window.setTimeout(() => void scanFrame(), SCAN_INTERVAL_MS);
      } catch (err) {
        stopCamera();
        const name = (err as { name?: string })?.name;
        if (name === "NotAllowedError" || name === "SecurityError") setCamera("denied");
        else if (name === "NotFoundError" || name === "OverconstrainedError") setCamera("unavailable");
        else setCamera("error");
      }
    },
    [deviceIds, deviceIndex, scanFrame, stopCamera],
  );

  const switchCamera = useCallback(() => {
    if (deviceIds.length < 2) return;
    const next = (deviceIndex + 1) % deviceIds.length;
    setDeviceIndex(next);
    void startCamera(next);
  }, [deviceIds.length, deviceIndex, startCamera]);

  // Stop the camera when leaving the scan step or the page, and while hidden.
  useEffect(() => {
    if (phase !== "scan") stopCamera();
  }, [phase, stopCamera]);
  useEffect(() => {
    const onHide = () => {
      if (document.hidden) stopCamera();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      stopCamera();
    };
  }, [stopCamera]);

  // ---------------------------------------------------------------- actions
  const removeCard = (token: string) => {
    setSelected((prev) => prev.filter((s) => s.token !== token));
    resolvedRef.current.delete(token);
  };

  const clearAll = () => {
    if (!window.confirm(t("clearConfirm"))) return;
    setSelected([]);
    resolvedRef.current.clear();
    setRejected([]);
    setIdempotencyKey(crypto.randomUUID());
  };

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manual.trim()) return;
    handleRaw(manual);
    setManual("");
  };

  const partnerName = useMemo(() => partners.find((p) => p.id === partnerId)?.name ?? "", [partners, partnerId]);

  const createHandover = async () => {
    if (!partnerId || selected.length === 0) return;
    setSubmitting(true);
    setReviewProblem(null);
    try {
      const result = await adminCreateHandoverAction({ idempotencyKey, toPartnerId: partnerId, tokens: selected.map((s) => s.token), note: note.trim() || undefined });
      if (result.ok) {
        setDone({ handoverId: result.handoverId, quantity: result.quantity, partnerName, duplicate: result.duplicate });
        setPhase("done");
        writeStored(null);
        return;
      }
      if (result.error === "ineligible" && "cards" in result) {
        const bad = result.cards.filter((c): c is Extract<CardEligibility, { eligible: false }> => !c.eligible);
        for (const c of bad) resolvedRef.current.set(c.token, c);
        setSelected((prev) => prev.filter((s) => !bad.some((b) => b.token === s.token)));
        // The selection changed, so this is a new request.
        setIdempotencyKey(crypto.randomUUID());
        setReviewProblem(bad.map((c) => ({ token: c.token, hint: c.hint, reason: c.reason, partnerName: c.partnerName })));
      } else {
        setReviewProblem(result.error as HandoverActionError);
      }
    } catch {
      // Network: the same idempotency key makes a retry safe.
      setReviewProblem("unknown");
    } finally {
      setSubmitting(false);
    }
  };

  const restart = () => {
    setSelected([]);
    setRejected([]);
    setPending([]);
    setNote("");
    setFeedback(null);
    resolvedRef.current.clear();
    setIdempotencyKey(crypto.randomUUID());
    setDone(null);
    setPhase("scan");
  };

  const reasonText = (reason: IneligibleReason, partner?: string) => t(`reasons.${reason}`, { partner: partner ?? "" });

  const feedbackNode = (() => {
    if (!feedback) return null;
    switch (feedback.kind) {
      case "added":
        return <Notice tone="success">{t("added")} <span className="font-mono text-caption">{feedback.hint}</span></Notice>;
      case "duplicate":
        return <Notice tone="info">{t("duplicate")} <span className="font-mono text-caption">{feedback.hint}</span></Notice>;
      case "checking":
        return <Notice tone="info">{t("checking")}</Notice>;
      case "network":
        return <Notice tone="warning">{t("networkError")}</Notice>;
      case "scanError":
        return <Notice tone="warning">{t(`scanReasons.${feedback.reason}`)}</Notice>;
      case "rejected":
        return <Notice tone="danger">{reasonText(feedback.reason, feedback.partnerName)} <span className="font-mono text-caption">{feedback.hint}</span></Notice>;
      case "actionError":
        return <Notice tone="danger">{t(`errors.${feedback.error}`, { count: 0 })}</Notice>;
    }
  })();

  // ---------------------------------------------------------------- render
  if (phase === "done" && done) {
    return (
      <Panel testId="handover-done">
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <div className="grid size-12 place-items-center rounded-full bg-success-soft text-success"><Check className="size-6" aria-hidden /></div>
          <h2 className="text-h3">{t("done.title")}</h2>
          <p className="text-body-sm text-ink-2" data-testid="handover-done-body">{t("done.body", { partner: done.partnerName, count: done.quantity })}</p>
          {done.duplicate && <p className="text-caption text-ink-3">{t("done.duplicate")}</p>}
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <ButtonLink href={`/admin/inventory/handovers/${done.handoverId}`} data-testid="handover-view-link">
              {t("done.view")}
            </ButtonLink>
            <Button variant="secondary" onClick={restart} data-testid="handover-scan-more">{t("done.scanMore")}</Button>
          </div>
        </div>
      </Panel>
    );
  }

  if (phase === "review") {
    return (
      <div className="flex flex-col gap-4" data-testid="handover-review">
        <Panel title={t("review.title")}>
          <div className="flex flex-col gap-4">
            <label className={fieldLabel}>
              {t("review.partner")}
              <select className={control} value={partnerId} onChange={(e) => setPartnerId(e.target.value)} data-testid="handover-partner-select">
                <option value="">{t("review.choosePartner")}</option>
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            {partners.length === 0 && <p className="text-caption text-danger">{t("review.noPartners")}</p>}

            <div className="flex items-baseline justify-between rounded-md bg-sunken px-4 py-3">
              <span className="text-body-sm text-ink-2">{t("review.selectedCards")}</span>
              <span className="font-serif text-[1.75rem] leading-none tabular-nums" data-testid="handover-review-count">{selected.length}</span>
            </div>
            <ul className="flex flex-wrap gap-1.5" aria-label={t("review.selectedCards")}>
              {selected.map((s, i) => (
                <li key={s.token} className="rounded-full bg-sunken px-2.5 py-1 font-mono text-caption text-ink-2">{i + 1}. {s.hint}</li>
              ))}
            </ul>

            <label className={fieldLabel}>
              {t("review.note")}
              <input className={control} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} data-testid="handover-note" />
            </label>

            <p className="text-caption text-ink-3">{t("review.explain")}</p>

            {Array.isArray(reviewProblem) && (
              <Notice tone="danger" title={t("review.ineligibleTitle")}>
                <p>{t("review.ineligibleBody")}</p>
                <ul className="mt-1 list-disc pl-5" data-testid="handover-review-ineligible">
                  {reviewProblem.map((r) => (
                    <li key={r.token}><span className="font-mono">{r.hint}</span> — {reasonText(r.reason, r.partnerName)}</li>
                  ))}
                </ul>
              </Notice>
            )}
            {typeof reviewProblem === "string" && <Notice tone="danger">{t(`errors.${reviewProblem}`, { count: 0 })}</Notice>}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <Button variant="secondary" icon={<ChevronLeft className="size-4" aria-hidden />} onClick={() => setPhase("scan")} data-testid="handover-back">
                {t("review.back")}
              </Button>
              <Button onClick={createHandover} loading={submitting} disabled={!partnerId || selected.length === 0} data-testid="handover-create">
                {t("review.create")}
              </Button>
            </div>
          </div>
        </Panel>
      </div>
    );
  }

  const live = camera === "live";
  return (
    <div className="flex flex-col gap-4 pb-24" data-testid="scan-assign">
      {!centralConfigured && <Notice tone="warning">{t("reasons.no_central_stock")}</Notice>}

      <div
        className={`relative overflow-hidden rounded-[var(--radius-lg)] bg-ink ring-1 ring-line transition-shadow ${flash === "ok" ? "ring-4 ring-success" : flash === "warn" ? "ring-4 ring-warning" : ""}`}
        data-flash={flash ?? ""}
      >
        <video
          ref={videoRef}
          className={`block aspect-[3/4] max-h-[55dvh] w-full object-cover sm:aspect-video ${live ? "" : "opacity-0"}`}
          muted
          playsInline
          autoPlay
          aria-label={t("camera.viewfinder")}
          data-testid="scan-video"
        />
        {live && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden>
            <div className="size-[60%] max-w-72 rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]" />
          </div>
        )}
        {!live && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-ink-inverse">
            {camera === "denied" || camera === "unavailable" || camera === "insecure" || camera === "error" ? (
              <div className="max-w-sm rounded-md bg-surface p-4 text-left text-ink" data-testid="camera-problem">
                <p className="font-medium">{camera === "denied" ? t("camera.deniedTitle") : t("camera.error")}</p>
                <p className="mt-1 text-body-sm text-ink-2">
                  {camera === "denied" ? t("camera.deniedBody") : camera === "insecure" ? t("camera.insecure") : camera === "unavailable" ? t("camera.unavailable") : t("camera.error")}
                </p>
                <Button className="mt-3" size="sm" variant="secondary" icon={<RefreshCw className="size-4" aria-hidden />} onClick={() => void startCamera()} data-testid="camera-retry">
                  {t("camera.retry")}
                </Button>
              </div>
            ) : (
              <Button variant="inverse" size="lg" loading={camera === "starting"} icon={<Camera className="size-5" aria-hidden />} onClick={() => void startCamera()} data-testid="camera-start">
                {camera === "starting" ? t("camera.starting") : t("camera.start")}
              </Button>
            )}
          </div>
        )}
        {live && (
          <div className="absolute right-2 top-2 flex gap-2">
            {deviceIds.length > 1 && (
              <Button size="sm" variant="inverse" onClick={switchCamera} aria-label={t("camera.switch")} data-testid="camera-switch">
                <SwitchCamera className="size-4" aria-hidden />
              </Button>
            )}
            <Button size="sm" variant="inverse" onClick={stopCamera} aria-label={t("camera.stop")} data-testid="camera-stop">
              <CameraOff className="size-4" aria-hidden />
            </Button>
          </div>
        )}
      </div>

      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-caption text-ink-2">{t("scanTitle")}</p>
          <p className="font-serif text-[2rem] leading-none tabular-nums" data-testid="scan-counter" aria-label={t("counter", { count: selected.length, target })}>
            {t("counterShort", { count: selected.length, target })}
          </p>
        </div>
        <label className="flex flex-col gap-1 text-caption text-ink-2">
          {t("targetLabel")}
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={500}
            value={target}
            onChange={(e) => setTarget(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
            className={`${control} w-24 tabular-nums`}
            data-testid="scan-target"
          />
        </label>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
        <div className="h-full rounded-full bg-success transition-[width]" style={{ width: `${Math.min(100, (selected.length / target) * 100)}%` }} />
      </div>
      <p className="text-caption text-ink-3">{t("scanIntro")} {t("targetHint")}</p>

      <div aria-live="polite" aria-atomic="true" data-testid="scan-feedback" data-kind={feedback?.kind ?? ""}>
        {feedbackNode}
      </div>

      {pending.length > 0 && (
        <Notice tone="warning" action={<Button size="sm" variant="secondary" onClick={retryPending} data-testid="scan-retry">{t("retryNow")}</Button>}>
          {t("pendingChecks", { count: pending.length })}
        </Notice>
      )}

      <form onSubmit={submitManual} className="flex flex-col gap-1.5" data-testid="manual-entry">
        <label htmlFor="manual-code" className="text-caption font-medium text-ink-2">{t("manual.title")}</label>
        <div className="flex gap-2">
          <input
            id="manual-code"
            className={`${control} font-mono`}
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder={t("manual.placeholder")}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            data-testid="manual-input"
          />
          <Button type="submit" variant="secondary" data-testid="manual-add">{t("manual.add")}</Button>
        </div>
      </form>

      {rejected.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-caption font-medium text-ink-2">{t("recentRejected")}</p>
          <ul className="flex flex-col gap-1 text-caption text-ink-2" data-testid="scan-rejected">
            {rejected.map((r) => (
              <li key={r.token} className="flex gap-2"><span className="font-mono">{r.hint}</span><span>{reasonText(r.reason, r.partnerName)}</span></li>
            ))}
          </ul>
        </div>
      )}

      {showList && (
        <Panel
          title={t("viewSelected", { count: selected.length })}
          actions={selected.length > 0 ? <Button size="sm" variant="danger" onClick={clearAll} data-testid="scan-clear">{t("clearAll")}</Button> : undefined}
          flush
          testId="scan-selected-list"
        >
          {selected.length === 0 ? (
            <p className="px-5 py-6 text-center text-caption text-ink-3">{t("noneSelected")}</p>
          ) : (
            <ul>
              {selected.map((s, i) => (
                <li key={s.token} className="flex items-center justify-between border-t border-line px-5 py-2 first:border-t-0" data-testid="scan-selected-item">
                  <span className="text-body-sm">
                    {t("cardLabel", { n: i + 1 })} <span className="font-mono text-caption text-ink-3">{s.hint}</span>
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => removeCard(s.token)} aria-label={t("removeCard", { hint: s.hint })} data-testid="scan-remove">
                    <X className="size-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 px-4 pt-3 backdrop-blur pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-3xl gap-2">
          <Button variant="secondary" className="flex-1" icon={<List className="size-4" aria-hidden />} onClick={() => setShowList((v) => !v)} data-testid="scan-toggle-list">
            {showList ? t("continue") : t("viewSelected", { count: selected.length })}
          </Button>
          <Button className="flex-1" disabled={selected.length === 0} onClick={() => { setShowList(false); setPhase("review"); }} data-testid="scan-finish">
            {t("finish")}
          </Button>
        </div>
      </div>
    </div>
  );
}
