"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { SELECTABLE_THEMES, getThemeConfig, type ThemeKey } from "@/lib/themes/registry";
import { updateThemeAction, updateMessageAction, viewPreviewAction } from "@/lib/greetings/actions";
import { startCheckoutAction, simulateTestPaymentAction, checkPaymentReturnAction } from "@/lib/payments/actions";
import type { CheckoutOrderSummary } from "@/lib/payments/checkout";
import { greetingMessageSchema, MESSAGE_MAX_LENGTH } from "@/lib/validation/greeting-text";
import { MediaUploadField } from "./media-upload-field";
import { VoiceRecorder } from "./voice-recorder";
import { GreetingRenderer, type GreetingRenderContent } from "./greeting-renderer";

type ExistingItem = { contentId: string; url: string } | null;

export type WizardInitialState = {
  greetingId: string;
  themeKey: ThemeKey;
  message: string;
  photos: (ExistingItem | null)[]; // length 3, index = slot
  video: ExistingItem;
  audio: ExistingItem;
  priceLabel: string | null;
  /** Whether the configured PaymentProvider is TEST — decided server-side (env.PAYMENTS_PROVIDER), never client-guessable. Gates the dev-only simulate-payment controls in CheckoutStep. */
  isTestPayments: boolean;
};

const STEPS = ["theme", "message", "media", "preview", "checkout"] as const;
type Step = (typeof STEPS)[number];
const FOCUS_RING = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

export function CreationWizard({ initial }: { initial: WizardInitialState }) {
  const t = useTranslations("wizard");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const step = (STEPS.includes(searchParams.get("step") as Step) ? (searchParams.get("step") as Step) : "theme") as Step;

  const [themeKey, setThemeKey] = useState<ThemeKey>(initial.themeKey);
  const [message, setMessage] = useState(initial.message);
  const [photos, setPhotos] = useState<(ExistingItem | null)[]>(initial.photos);
  const [video, setVideo] = useState<ExistingItem>(initial.video);
  const [audio, setAudio] = useState<ExistingItem>(initial.audio);

  const goToStep = useCallback(
    (next: Step) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("step", next);
      router.push(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams],
  );

  const content: GreetingRenderContent = {
    message: message.trim() || null,
    photos: photos.filter((p): p is { contentId: string; url: string } => !!p).map((p) => ({ id: p.contentId, url: p.url })),
    video: video ? { url: video.url } : null,
    audio: audio ? { url: audio.url } : null,
  };

  const WIZARD_STEPS = ["theme", "message", "media"] as const satisfies readonly Step[];
  const wizardStepIndex = WIZARD_STEPS.indexOf(step as (typeof WIZARD_STEPS)[number]);

  return (
    <div className="flex min-h-screen w-full flex-col bg-neutral-950 text-neutral-100">
      {wizardStepIndex >= 0 && (
        <header className="flex items-center justify-between px-5 py-[max(1rem,env(safe-area-inset-top))]">
          <button
            type="button"
            onClick={() => wizardStepIndex > 0 && goToStep(WIZARD_STEPS[wizardStepIndex - 1]!)}
            disabled={wizardStepIndex === 0}
            className={`text-sm opacity-70 disabled:opacity-0 ${FOCUS_RING}`}
            data-testid="wizard-back"
          >
            ← {t("back")}
          </button>
          <div className="flex gap-1.5" role="presentation">
            {WIZARD_STEPS.map((s, i) => (
              <span key={s} className="h-1.5 w-6 rounded-full" style={{ background: i <= wizardStepIndex ? "#ffffff" : "rgba(255,255,255,0.2)" }} />
            ))}
          </div>
          <span className="w-12" />
        </header>
      )}
      {step === "checkout" && (
        <header className="flex items-center px-5 py-[max(1rem,env(safe-area-inset-top))]">
          <button type="button" onClick={() => goToStep("preview")} className={`text-sm opacity-70 ${FOCUS_RING}`} data-testid="checkout-back-to-preview">
            ← {t("backToPreview")}
          </button>
        </header>
      )}

      <main className="flex flex-1 flex-col px-5 pb-[max(2.5rem,env(safe-area-inset-bottom))]">
        {step === "theme" && (
          <ThemeStep
            greetingId={initial.greetingId}
            selected={themeKey}
            onSelect={setThemeKey}
            onContinue={() => goToStep("message")}
          />
        )}
        {step === "message" && (
          <MessageStep
            greetingId={initial.greetingId}
            message={message}
            onChange={setMessage}
            onContinue={() => goToStep("media")}
          />
        )}
        {step === "media" && (
          <MediaStep
            greetingId={initial.greetingId}
            photos={photos}
            video={video}
            audio={audio}
            onPhotoChange={(slot, item) => setPhotos((p) => p.map((v, i) => (i === slot ? item : v)))}
            onVideoChange={setVideo}
            onAudioChange={setAudio}
            onContinue={() => goToStep("preview")}
          />
        )}
        {step === "preview" && (
          <PreviewStep
            greetingId={initial.greetingId}
            theme={getThemeConfig(themeKey)}
            content={content}
            priceLabel={initial.priceLabel}
            onEdit={() => goToStep("theme")}
            onCheckout={() => goToStep("checkout")}
          />
        )}
        {step === "checkout" && (
          <CheckoutStep greetingId={initial.greetingId} isTestPayments={initial.isTestPayments} onBackToPreview={() => goToStep("preview")} />
        )}
      </main>
    </div>
  );
}

function StepShell({ title, subtitle, children, onContinue, continueLabel, continueDisabled }: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onContinue: () => void;
  continueLabel?: string;
  continueDisabled?: boolean;
}) {
  const t = useTranslations("wizard");
  return (
    <div className="flex flex-1 flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-neutral-400">{subtitle}</p>}
      </div>
      <div className="flex-1">{children}</div>
      <button
        type="button"
        onClick={onContinue}
        disabled={continueDisabled}
        className={`w-full rounded-full bg-white py-3.5 text-sm font-semibold text-black disabled:opacity-40 ${FOCUS_RING}`}
        data-testid="wizard-continue"
      >
        {continueLabel ?? t("continue")}
      </button>
    </div>
  );
}

function ThemeStep({ greetingId, selected, onSelect, onContinue }: { greetingId: string; selected: ThemeKey; onSelect: (k: ThemeKey) => void; onContinue: () => void }) {
  const t = useTranslations("wizard.theme");
  const tt = useTranslations("themes");
  const [saving, setSaving] = useState(false);

  async function choose(key: ThemeKey) {
    onSelect(key);
    setSaving(true);
    await updateThemeAction(greetingId, key);
    setSaving(false);
  }

  return (
    <StepShell title={t("title")} subtitle={t("subtitle")} onContinue={onContinue} continueDisabled={saving}>
      <div className="grid grid-cols-1 gap-3" data-testid="theme-step" role="radiogroup" aria-label={t("title")}>
        {SELECTABLE_THEMES.map((theme) => (
          <button
            key={theme.key}
            type="button"
            onClick={() => choose(theme.key)}
            role="radio"
            aria-checked={selected === theme.key}
            className={`flex items-center justify-between rounded-2xl border p-4 text-left transition ${FOCUS_RING}`}
            style={{
              borderColor: selected === theme.key ? theme.palette.accent : "rgba(255,255,255,0.15)",
              background: theme.palette.backgroundGradient,
            }}
            data-testid={`theme-option-${theme.key}`}
          >
            <div>
              <p className="font-medium" style={{ color: theme.palette.text, fontFamily: theme.fontFamily }}>
                {tt(`${theme.key}.name`)}
              </p>
              <p className="text-xs" style={{ color: theme.palette.textMuted }}>
                {tt(`${theme.key}.tagline`)}
              </p>
            </div>
            {selected === theme.key && (
              <span className="text-lg" style={{ color: theme.palette.accent }} aria-hidden="true">
                ✓
              </span>
            )}
          </button>
        ))}
      </div>
    </StepShell>
  );
}

function MessageStep({ greetingId, message, onChange, onContinue }: { greetingId: string; message: string; onChange: (v: string) => void; onContinue: () => void }) {
  const t = useTranslations("wizard.message");
  const tCommon = useTranslations("wizard");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const limit = MESSAGE_MAX_LENGTH;

  async function handleContinue() {
    const trimmed = message.trim();
    if (trimmed.length === 0) {
      setError(t("errorEmpty"));
      return;
    }
    if (trimmed.length > limit) {
      setError(t("errorTooLong"));
      return;
    }
    const parsed = greetingMessageSchema.safeParse(message);
    if (!parsed.success) {
      setError(t("errorEmpty"));
      return;
    }
    setError(null);
    setSaving(true);
    const result = await updateMessageAction(greetingId, message);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onContinue();
  }

  return (
    <StepShell title={t("title")} subtitle={t("subtitle")} onContinue={handleContinue} continueDisabled={saving} continueLabel={saving ? tCommon("saving") : undefined}>
      <label htmlFor="greeting-message" className="sr-only">
        {t("title")}
      </label>
      <textarea
        id="greeting-message"
        value={message}
        onChange={(e) => onChange(e.target.value.slice(0, limit))}
        placeholder={t("placeholder")}
        rows={8}
        aria-invalid={!!error}
        aria-describedby={error ? "greeting-message-error" : undefined}
        className={`w-full resize-none rounded-2xl border border-white/15 bg-white/5 p-4 text-base leading-relaxed outline-none placeholder:text-neutral-500 ${FOCUS_RING}`}
        data-testid="message-textarea"
      />
      <div className="mt-2 flex items-center justify-between text-xs text-neutral-500">
        <span id="greeting-message-error" role="alert">
          {error && <span className="text-red-400">{error}</span>}
        </span>
        <span>
          {message.length}/{limit}
        </span>
      </div>
    </StepShell>
  );
}

function MediaStep({
  greetingId,
  photos,
  video,
  audio,
  onPhotoChange,
  onVideoChange,
  onAudioChange,
  onContinue,
}: {
  greetingId: string;
  photos: (ExistingItem | null)[];
  video: ExistingItem;
  audio: ExistingItem;
  onPhotoChange: (slot: number, item: ExistingItem) => void;
  onVideoChange: (item: ExistingItem) => void;
  onAudioChange: (item: ExistingItem) => void;
  onContinue: () => void;
}) {
  const t = useTranslations("wizard.media");
  return (
    <StepShell title={t("title")} subtitle={t("subtitle")} onContinue={onContinue}>
      <div className="flex flex-col gap-6" data-testid="media-step">
        <section>
          <h2 className="mb-2 text-sm font-medium text-neutral-300">{t("photos")}</h2>
          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2].map((slot) => (
              <MediaUploadField
                key={slot}
                greetingId={greetingId}
                type="photo"
                slot={slot}
                existing={photos[slot] ?? null}
                onChanged={(item) => onPhotoChange(slot, item)}
              />
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-medium text-neutral-300">{t("video")}</h2>
          <MediaUploadField greetingId={greetingId} type="video" slot={0} existing={video} onChanged={onVideoChange} />
        </section>

        <section>
          <h2 className="mb-2 text-sm font-medium text-neutral-300">{t("voice")}</h2>
          <VoiceRecorder greetingId={greetingId} existing={audio} onChanged={onAudioChange} />
        </section>
      </div>
    </StepShell>
  );
}

function PreviewStep({
  greetingId,
  theme,
  content,
  priceLabel,
  onEdit,
  onCheckout,
}: {
  greetingId: string;
  theme: ReturnType<typeof getThemeConfig>;
  content: GreetingRenderContent;
  priceLabel: string | null;
  onEdit: () => void;
  onCheckout: () => void;
}) {
  const t = useTranslations("wizard.preview");
  // Guards against React StrictMode's dev-only double-invoke and any
  // remount while this step stays mounted — PREVIEW_VIEWED must fire once
  // per genuine "sender opened Preview" action, not once per render/effect
  // re-run (Phase 2 §13).
  const recordedRef = useRef(false);
  useEffect(() => {
    if (recordedRef.current) return;
    recordedRef.current = true;
    void viewPreviewAction(greetingId);
  }, [greetingId]);

  return (
    <GreetingRenderer
      theme={theme}
      content={content}
      mode="preview"
      senderControls={
        <div className="mt-4 flex flex-col items-center gap-3" data-testid="preview-sender-controls">
          <button type="button" onClick={onEdit} className={`text-sm underline opacity-80 ${FOCUS_RING}`} data-testid="preview-edit">
            {t("edit")}
          </button>
          {priceLabel ? (
            <button
              type="button"
              onClick={onCheckout}
              className={`rounded-full px-6 py-3 text-sm font-semibold text-black ${FOCUS_RING}`}
              style={{ background: theme.palette.accent }}
              data-testid="preview-activate-cta"
            >
              {t("activate", { price: priceLabel })}
            </button>
          ) : (
            <p className="text-xs text-red-300" data-testid="preview-price-unavailable">
              {t("priceUnavailable")}
            </p>
          )}
        </div>
      }
    />
  );
}

/** How many times to poll checkPaymentReturnAction after a real-provider redirect before falling back to showing the normal Checkout screen with a manual retry. */
const RETURN_POLL_ATTEMPTS = 5;
const RETURN_POLL_INTERVAL_MS = 2000;

function CheckoutStep({
  greetingId,
  isTestPayments,
  onBackToPreview,
}: {
  greetingId: string;
  isTestPayments: boolean;
  onBackToPreview: () => void;
}) {
  const t = useTranslations("wizard.checkout");
  const searchParams = useSearchParams();
  // A hint only, for which initial UI to show — never authority. The actual
  // status always comes from checkPaymentReturnAction/startCheckoutAction,
  // which re-derive it server-side from the order's own DB state (Phase 5 §5:
  // "a browser return URL must never be treated as proof of payment").
  const paymentHint = searchParams.get("payment");

  const [summary, setSummary] = useState<CheckoutOrderSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(paymentHint === "return");
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [cancelled, setCancelled] = useState(paymentHint === "cancelled");
  const [succeeded, setSucceeded] = useState(false);
  const startedRef = useRef(false);

  const loadSummary = useCallback(async () => {
    const result = await startCheckoutAction(greetingId);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSummary(result.data.summary);
    if (result.data.recovered) {
      // A prior payment already succeeded but activation hadn't completed —
      // it's been reconciled just now. Go straight to the success view.
      window.location.href = window.location.pathname;
    }
  }, [greetingId]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    if (paymentHint !== "return") {
      loadSummary();
      return;
    }

    (async () => {
      for (let attempt = 0; attempt < RETURN_POLL_ATTEMPTS; attempt++) {
        const result = await checkPaymentReturnAction(greetingId);
        if (!result.ok) {
          setVerifying(false);
          setError(result.error);
          return;
        }
        if (result.data.status === "PAID") {
          window.location.href = window.location.pathname;
          return;
        }
        if (result.data.status === "FAILED" || result.data.status === "CANCELED") {
          setFailed(true);
          break;
        }
        if (attempt < RETURN_POLL_ATTEMPTS - 1) {
          await new Promise((resolve) => setTimeout(resolve, RETURN_POLL_INTERVAL_MS));
        }
      }
      setVerifying(false);
      await loadSummary();
    })();
  }, [greetingId, paymentHint, loadSummary]);

  async function pay(outcome: "success" | "failure") {
    setPaying(true);
    setError(null);
    setFailed(false);
    const result = await simulateTestPaymentAction(greetingId, outcome);
    setPaying(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.data.status === "FAILED") {
      setFailed(true);
      return;
    }
    setSucceeded(true);
    // The Greeting is now ACTIVE — reload the same public URL so the
    // dispatcher (/g/[token]) re-resolves to the Sender Success experience.
    window.location.href = window.location.pathname;
  }

  function payReal() {
    if (!summary?.redirectUrl) return;
    setPaying(true);
    window.location.href = summary.redirectUrl;
  }

  async function retry() {
    setFailed(false);
    setCancelled(false);
    setLoading(true);
    await loadSummary();
  }

  const showRealPayButton = !isTestPayments && !failed && !cancelled;

  return (
    <div className="flex flex-1 flex-col gap-6" data-testid="checkout-step">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-neutral-400">{t("subtitle")}</p>
      </div>

      {verifying && (
        <div className="flex flex-col items-center gap-2 py-10 text-center" data-testid="checkout-verifying" role="status" aria-live="polite">
          <p className="text-sm font-medium">{t("verifying")}</p>
          <p className="text-xs text-neutral-500">{t("verifyingBody")}</p>
        </div>
      )}

      {!verifying && loading && <p className="text-sm text-neutral-400">{t("loading")}</p>}

      {!verifying && !loading && summary && !succeeded && (
        <div className="flex flex-col gap-6">
          <div className="rounded-2xl border border-white/15 bg-white/5 p-5">
            <p className="text-sm text-neutral-400">{t("activationLabel")}</p>
            <p className="mt-1 text-3xl font-semibold" data-testid="checkout-amount">
              {(summary.grossAmountMinor / 100).toFixed(2)} {summary.currency}
            </p>
            <p className="mt-2 text-xs text-neutral-500">{t("explanation")}</p>
          </div>

          {cancelled && (
            <p className="text-sm text-neutral-400" role="status" data-testid="payment-cancelled-message">
              {t("cancelledMessage")}
            </p>
          )}
          {failed && (
            <p className="text-sm text-red-400" role="alert" data-testid="payment-failed-message">
              {t("paymentFailed")}
            </p>
          )}
          {error && (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          )}

          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => (failed || cancelled ? retry() : isTestPayments ? pay("success") : payReal())}
              disabled={paying || (showRealPayButton && !summary.redirectUrl)}
              className={`w-full rounded-full bg-white py-3.5 text-sm font-semibold text-black disabled:opacity-40 ${FOCUS_RING}`}
              data-testid={failed || cancelled ? "checkout-retry" : "checkout-pay"}
            >
              {paying
                ? t("processing")
                : failed || cancelled
                  ? t("retry")
                  : isTestPayments
                    ? t("payButton")
                    : t("payButtonReal")}
            </button>

            {isTestPayments && !failed && (
              <details className="text-xs text-neutral-500">
                <summary className={`cursor-pointer ${FOCUS_RING}`} data-testid="checkout-testing-toggle">
                  {t("testingOptions")}
                </summary>
                <button
                  type="button"
                  onClick={() => pay("failure")}
                  disabled={paying}
                  className={`mt-2 text-red-400 underline disabled:opacity-40 ${FOCUS_RING}`}
                  data-testid="checkout-simulate-failure"
                >
                  {t("simulateFailure")}
                </button>
              </details>
            )}

            <button type="button" onClick={onBackToPreview} className={`text-sm underline opacity-70 ${FOCUS_RING}`} data-testid="checkout-back-link">
              {t("backToPreview")}
            </button>
          </div>
        </div>
      )}

      {succeeded && <p className="text-sm text-neutral-400">{t("activating")}</p>}

      {!verifying && !loading && !summary && error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
