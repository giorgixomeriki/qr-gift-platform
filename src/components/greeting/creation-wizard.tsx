"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { ArrowRight, ChevronLeft, Lock, Pencil, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { ActionBar } from "@/components/flow/shell";
import { Button } from "@/components/ui/button";
import { Logo, Spark } from "@/components/ui/logo";
import { Notice } from "@/components/ui/notice";
import { Spinner } from "@/components/ui/spinner";
import { formatMinorAmount } from "@/lib/format/money";
import type { ThemeKey } from "@/lib/themes/registry";
import { getThemeWorld, worldVars } from "@/lib/themes/worlds";
import { getTemplate } from "@/lib/templates/catalog";
import { roomVars } from "@/lib/templates/room";
import { ThemeWorld } from "@/components/themes/theme-world";
import { updateMessageAction, viewPreviewAction } from "@/lib/greetings/actions";
import { startCheckoutAction, simulateTestPaymentAction, checkPaymentReturnAction } from "@/lib/payments/actions";
import type { CheckoutOrderSummary } from "@/lib/payments/checkout";
import { greetingMessageSchema, MESSAGE_MAX_LENGTH } from "@/lib/validation/greeting-text";
import { MediaUploadField } from "./media-upload-field";
import { VoiceRecorder } from "./voice-recorder";
import { GreetingRenderer, type GreetingRenderContent } from "./greeting-renderer";
import { LivePreview } from "./live-preview";
import { LocaleSwitcher } from "./locale-switcher";
import { ThemePicker } from "./theme-picker";

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
const WIZARD_STEPS = ["theme", "message", "media"] as const satisfies readonly Step[];

/** Server action errors are developer-facing English; consumers always see localized copy. */
function logActionError(scope: string, error: string) {
  console.error(`[${scope}]`, error);
}

export function CreationWizard({ initial }: { initial: WizardInitialState }) {
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
      params.delete("payment");
      router.push(`${pathname}?${params.toString()}`);
      window.scrollTo({ top: 0 });
    },
    [pathname, router, searchParams],
  );

  const content: GreetingRenderContent = {
    message: message.trim() || null,
    photos: photos.filter((p): p is { contentId: string; url: string } => !!p).map((p) => ({ id: p.contentId, url: p.url })),
    video: video ? { url: video.url } : null,
    audio: audio ? { url: audio.url } : null,
  };

  if (step === "preview") {
    return (
      <PreviewStep
        greetingId={initial.greetingId}
        themeKey={themeKey}
        content={content}
        priceLabel={initial.priceLabel}
        onEdit={() => goToStep("theme")}
        onCheckout={() => goToStep("checkout")}
      />
    );
  }

  const wizardStepIndex = WIZARD_STEPS.indexOf(step as (typeof WIZARD_STEPS)[number]);

  return (
    <div className="flex min-h-dvh w-full flex-col">
      <WizardHeader
        step={step}
        wizardStepIndex={wizardStepIndex}
        onBack={() => (step === "checkout" ? goToStep("preview") : wizardStepIndex > 0 && goToStep(WIZARD_STEPS[wizardStepIndex - 1]!))}
      />

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 sm:px-6">
        {step === "theme" ? (
          <div className="flex flex-1 flex-col">
            <div className="lg:max-w-[22rem]">
              <StepProgress index={wizardStepIndex} step={step} />
            </div>
            <ThemePicker greetingId={initial.greetingId} selected={themeKey} onSelect={setThemeKey} onContinue={() => goToStep("message")} />
          </div>
        ) : step === "checkout" ? (
          <div className="mx-auto flex w-full max-w-xl flex-1 flex-col">
            <CheckoutStep
              greetingId={initial.greetingId}
              isTestPayments={initial.isTestPayments}
              themeKey={themeKey}
              content={content}
              onBackToPreview={() => goToStep("preview")}
              onEdit={() => goToStep("theme")}
            />
          </div>
        ) : (
          <div className={`grid flex-1 gap-12 lg:gap-16 lg:pt-4 ${step === "message" ? "" : "lg:grid-cols-[minmax(0,1fr)_320px]"}`}>
            <div className="mx-auto flex w-full max-w-xl flex-col">
              <StepProgress index={wizardStepIndex} step={step} />
              {step === "message" && (
                <MessageStep
                  greetingId={initial.greetingId}
                  themeKey={themeKey}
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
            </div>
            <aside className={step === "message" ? "hidden" : "hidden lg:block"} aria-hidden>
              <div className="sticky top-20">
                <LivePreview themeKey={themeKey} content={content} />
              </div>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}

function WizardHeader({ step, wizardStepIndex, onBack }: { step: Step; wizardStepIndex: number; onBack: () => void }) {
  const t = useTranslations("wizard");
  const showBack = step === "checkout" || wizardStepIndex > 0;
  return (
    <header className="sticky top-0 z-20 bg-paper/85 pt-[var(--safe-top)] backdrop-blur-md supports-[backdrop-filter]:bg-paper/75">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
        {showBack ? (
          <button
            type="button"
            onClick={onBack}
            className="-ml-2 inline-flex h-10 items-center gap-1 rounded-md pr-3 pl-1.5 text-label text-ink-2 transition-colors hover:bg-sunken hover:text-ink"
            data-testid={step === "checkout" ? "checkout-back-to-preview" : "wizard-back"}
          >
            <ChevronLeft className="size-5" aria-hidden />
            {t("back")}
          </button>
        ) : (
          <Logo className="text-[0.9375rem]" />
        )}
        <LocaleSwitcher />
      </div>
    </header>
  );
}

function StepProgress({ index, step }: { index: number; step: Step }) {
  const t = useTranslations("wizard");
  return (
    <div className="pt-2">
      <p className="text-caption text-ink-3">
        <span className="text-ink-2">{t("stepOf", { current: index + 1, total: WIZARD_STEPS.length })}</span>
        <span aria-hidden> · </span>
        <span className="font-medium text-ink">{t(`steps.${step}`)}</span>
      </p>
      <div
        className="mt-2.5 grid grid-cols-3 gap-1.5"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={WIZARD_STEPS.length}
        aria-valuenow={index + 1}
        aria-label={t("stepOf", { current: index + 1, total: WIZARD_STEPS.length })}
      >
        {WIZARD_STEPS.map((s, i) => (
          <span key={s} className="h-1 overflow-hidden rounded-full bg-line">
            <span
              className="block h-full rounded-full bg-ink transition-transform duration-500 ease-out"
              style={{ transform: `scaleX(${i <= index ? 1 : 0})`, transformOrigin: "left" }}
            />
          </span>
        ))}
      </div>
    </div>
  );
}

function StepShell({
  title,
  subtitle,
  children,
  onContinue,
  continueLabel,
  continueDisabled,
  continueLoading,
  note,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onContinue: () => void;
  continueLabel?: string;
  continueDisabled?: boolean;
  continueLoading?: boolean;
  note?: React.ReactNode;
}) {
  const t = useTranslations("wizard");
  return (
    <div className="animate-rise flex flex-1 flex-col pt-6">
      <h1 className="text-h1">{title}</h1>
      {subtitle && <p className="mt-2 text-body text-ink-2">{subtitle}</p>}
      <div className="mt-8 flex-1">{children}</div>
      <ActionBar note={note}>
        <Button size="lg" block onClick={onContinue} disabled={continueDisabled} loading={continueLoading} data-testid="wizard-continue">
          {continueLabel ?? t("continue")}
        </Button>
      </ActionBar>
    </div>
  );
}

function MessageStep({
  greetingId,
  themeKey,
  message,
  onChange,
  onContinue,
}: {
  greetingId: string;
  themeKey: ThemeKey;
  message: string;
  onChange: (v: string) => void;
  onContinue: () => void;
}) {
  const t = useTranslations("wizard.message");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const limit = MESSAGE_MAX_LENGTH;
  const world = getThemeWorld(themeKey);
  const room = getTemplate(themeKey)?.spec.room;

  async function handleContinue() {
    const trimmed = message.trim();
    if (trimmed.length === 0) {
      setError(t("errorEmpty"));
      document.getElementById("greeting-message")?.focus();
      return;
    }
    if (trimmed.length > limit) {
      setError(t("errorTooLong", { limit }));
      return;
    }
    const parsed = greetingMessageSchema.safeParse(message);
    if (!parsed.success) {
      setError(t("errorEmpty"));
      return;
    }
    setError(null);
    setSaving(true);
    const result = await updateMessageAction(greetingId, message).catch(() => null);
    setSaving(false);
    if (!result?.ok) {
      if (result) logActionError("updateMessage", result.error);
      setError(t("errorSave"));
      return;
    }
    onContinue();
  }

  const remaining = limit - message.length;
  const describedBy = error ? "greeting-message-error" : "greeting-message-hint";

  return (
    <StepShell title={t("title")} subtitle={t("subtitle")} onContinue={handleContinue} continueLoading={saving}>
      {/* Written directly on the card of the chosen world — its card stock, ink and type, in its room: what you type is what they'll read. */}
      <label htmlFor="greeting-message" className="sr-only">
        {t("label")}
      </label>
      <div
        className="world-desk -mx-4 px-4 py-8 sm:mx-0 sm:rounded-[var(--radius-lg)] sm:px-8"
        style={{ ...worldVars(world), ...(room && roomVars(room)) }}
        data-composition={world.composition}
      >
        <div
          className={`world-sheet mx-auto flex min-h-[22rem] w-full max-w-[26rem] flex-col items-center px-7 pt-9 pb-6 transition-shadow sm:px-9 ${
            error ? "ring-2 ring-danger ring-offset-2 ring-offset-transparent" : "focus-within:ring-2 focus-within:ring-[color-mix(in_oklab,var(--w-ink)_35%,transparent)]"
          }`}
        >
          <Spark className="world-sheet__mark size-5 shrink-0" />
          <textarea
            id="greeting-message"
            value={message}
            onChange={(e) => {
              onChange(e.target.value.slice(0, limit));
              if (error && e.target.value.trim()) setError(null);
            }}
            placeholder={t("placeholder")}
            autoCapitalize="sentences"
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className="world-sheet__text relative z-10 mt-5 w-full flex-1 resize-none bg-transparent outline-none focus-visible:outline-none [field-sizing:content] min-h-[15rem]"
            data-testid="message-textarea"
          />
        </div>
      </div>
      <div className="mt-3 flex items-start justify-between gap-4 text-caption">
        {error ? (
          <p id="greeting-message-error" className="flex items-start gap-1.5 text-danger" role="alert">
            {error}
          </p>
        ) : (
          <p id="greeting-message-hint" className="text-ink-3">
            {t("hint")}
          </p>
        )}
        <span className={`shrink-0 tabular-nums ${remaining <= 60 ? "text-warning" : "text-ink-3"}`}>
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
  const tw = useTranslations("wizard");
  const hasAny = photos.some(Boolean) || !!video || !!audio;
  return (
    <StepShell title={t("title")} subtitle={t("subtitle")} onContinue={onContinue} continueLabel={hasAny ? tw("toPreview") : tw("skipToPreview")}>
      <div className="flex flex-col gap-8" data-testid="media-step">
        <MediaSection title={t("photos")} hint={t("photosHint")}>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
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
        </MediaSection>

        <MediaSection title={t("voice")} hint={t("voiceHint")}>
          <VoiceRecorder greetingId={greetingId} existing={audio} onChanged={onAudioChange} />
        </MediaSection>

        <MediaSection title={t("video")} hint={t("videoHint")}>
          <MediaUploadField greetingId={greetingId} type="video" slot={0} existing={video} onChanged={onVideoChange} />
        </MediaSection>
      </div>
    </StepShell>
  );
}

function MediaSection({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-h3">{title}</h2>
        <span className="text-caption text-ink-3">{hint}</span>
      </div>
      {children}
    </section>
  );
}

function PreviewStep({
  greetingId,
  themeKey,
  content,
  priceLabel,
  onEdit,
  onCheckout,
}: {
  greetingId: string;
  themeKey: ThemeKey;
  content: GreetingRenderContent;
  priceLabel: string | null;
  onEdit: () => void;
  onCheckout: () => void;
}) {
  const t = useTranslations("wizard.preview");
  // One primary action at a time: while the greeting plays, its own controls
  // lead and Activate waits quietly; at the ending, Activate takes the lead.
  const [atEnding, setAtEnding] = useState(false);
  const handleBeat = useCallback((kind: string) => setAtEnding(kind === "ending"), []);
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

  // A viewing layer, not an editor: plain bars above and below, and the
  // greeting — exactly as the recipient gets it — in between, untouched.
  return (
    <div className="flex h-dvh w-full flex-col bg-surface">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-2 pt-[var(--safe-top)] sm:px-4">
        <button
          type="button"
          onClick={onEdit}
          aria-label={t("edit")}
          className="grid size-11 place-items-center rounded-md text-ink-2 transition-colors hover:bg-sunken hover:text-ink"
        >
          <X className="size-5" aria-hidden />
        </button>
        <p className="flex-1 text-center text-label text-ink">{t("viewingAs")}</p>
        <span className="size-11" aria-hidden />
      </header>

      <GreetingRenderer themeKey={themeKey} content={content} mode="preview" embedded onBeatChange={handleBeat} />

      {/* State-driven actions, never competing with the greeting's own control:
          while it's sealed or playing, a single quiet row (the greeting's Open /
          Continue is the one primary); at the ending, Activate becomes the primary. */}
      <footer className="shrink-0 border-t border-line bg-surface px-4 pb-[max(0.5rem,var(--safe-bottom))]" data-testid="preview-sender-controls">
        {!priceLabel ? (
          <div className="mx-auto flex max-w-md flex-col gap-2 py-3">
            <Notice tone="danger">
              <span data-testid="preview-price-unavailable">{t("priceUnavailable")}</span>
            </Notice>
            <Button variant="secondary" size="lg" block onClick={onEdit} data-testid="preview-edit">
              {t("edit")}
            </Button>
          </div>
        ) : atEnding ? (
          <div className="animate-rise mx-auto flex max-w-md flex-col gap-2 pt-3">
            <p className="text-center text-caption text-ink-3">{t("readyBody")}</p>
            <div className="flex gap-2">
              <Button variant="secondary" size="lg" onClick={onEdit} className="shrink-0" data-testid="preview-edit">
                {t("editShort")}
              </Button>
              <Button size="lg" block onClick={onCheckout} className="flex-1" data-testid="preview-activate-cta">
                {t("activate", { price: priceLabel })}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex h-14 max-w-md items-center justify-between gap-3">
            <Button variant="ghost" size="md" onClick={onEdit} icon={<Pencil className="size-4" aria-hidden />} className="-ml-2" data-testid="preview-edit">
              {t("editShort")}
            </Button>
            <Button
              variant="ghost"
              size="md"
              onClick={onCheckout}
              iconEnd={<ArrowRight className="size-4" aria-hidden />}
              className="-mr-2 text-ink"
              data-testid="preview-activate-cta"
            >
              {t("activate", { price: priceLabel })}
            </Button>
          </div>
        )}
      </footer>
    </div>
  );
}

/** How many times to poll checkPaymentReturnAction after a real-provider redirect before falling back to showing the normal Checkout screen with a manual retry. */
const RETURN_POLL_ATTEMPTS = 5;
const RETURN_POLL_INTERVAL_MS = 2000;

function CheckoutStep({
  greetingId,
  isTestPayments,
  themeKey,
  content,
  onBackToPreview,
  onEdit,
}: {
  greetingId: string;
  isTestPayments: boolean;
  themeKey: ThemeKey;
  content: GreetingRenderContent;
  onBackToPreview: () => void;
  onEdit: () => void;
}) {
  const t = useTranslations("wizard.checkout");
  const tt = useTranslations("themes");
  const locale = useLocale();
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
  const [error, setError] = useState(false);
  const [failed, setFailed] = useState(false);
  const [cancelled, setCancelled] = useState(paymentHint === "cancelled");
  const [succeeded, setSucceeded] = useState(false);
  /**
   * Back from the provider, but the outcome is not known yet (still pending
   * after polling, or the status check itself failed). Never offer to pay
   * again here — a second charge is exactly the risk — only to check again.
   */
  const [uncertain, setUncertain] = useState(false);
  const startedRef = useRef(false);

  const loadSummary = useCallback(async () => {
    const result = await startCheckoutAction(greetingId).catch(() => null);
    setLoading(false);
    if (!result?.ok) {
      if (result) logActionError("startCheckout", result.error);
      setError(true);
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
    void verifyReturn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [greetingId, paymentHint, loadSummary]);

  /** Polls the server's own verdict (never the URL) after a provider redirect. */
  async function verifyReturn() {
    setUncertain(false);
    setVerifying(true);
    for (let attempt = 0; attempt < RETURN_POLL_ATTEMPTS; attempt++) {
      const result = await checkPaymentReturnAction(greetingId).catch(() => null);
      if (result?.ok && result.data.status === "PAID") {
        window.location.href = window.location.pathname;
        return;
      }
      if (result?.ok && (result.data.status === "FAILED" || result.data.status === "CANCELED")) {
        // Only a definite failure offers paying again.
        setVerifying(false);
        setFailed(true);
        await loadSummary();
        return;
      }
      if (result && !result.ok) logActionError("checkPaymentReturn", result.error);
      if (attempt < RETURN_POLL_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, RETURN_POLL_INTERVAL_MS));
      }
    }
    // Still pending, or the check kept failing: the payment may have gone
    // through. Hold here rather than show a Pay button.
    setVerifying(false);
    setUncertain(true);
  }

  async function pay(outcome: "success" | "failure") {
    setPaying(true);
    setError(false);
    setFailed(false);
    const result = await simulateTestPaymentAction(greetingId, outcome).catch(() => null);
    if (!result?.ok) {
      if (result) logActionError("simulateTestPayment", result.error);
      setPaying(false);
      setError(true);
      return;
    }
    if (result.data.status === "FAILED") {
      setPaying(false);
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
    setError(false);
    setLoading(true);
    await loadSummary();
  }

  const showRealPayButton = !isTestPayments && !failed && !cancelled;
  const amountLabel = summary ? formatMinorAmount(summary.grossAmountMinor, summary.currency, locale) : null;
  const items = [
    content.message ? t("items.message") : null,
    content.photos.length ? t("items.photos", { count: content.photos.length }) : null,
    content.video ? t("items.video") : null,
    content.audio ? t("items.voice") : null,
    t("items.theme", { name: tt(`${themeKey}.name`) }),
  ].filter(Boolean) as string[];

  return (
    <div className="animate-rise flex flex-1 flex-col gap-7 pt-4" data-testid="checkout-step">
      <header>
        <h1 className="text-h1">{t("title")}</h1>
        <p className="mt-2 text-body text-ink-2">{t("subtitle")}</p>
      </header>

      {uncertain ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-16 text-center" data-testid="checkout-still-verifying" role="status" aria-live="polite">
          <div>
            <p className="text-h3">{t("stillVerifying")}</p>
            <p className="mt-1 text-body-sm text-ink-2">{t("stillVerifyingBody")}</p>
          </div>
          <Button variant="secondary" size="lg" onClick={() => void verifyReturn()} data-testid="checkout-check-again">
            {t("checkAgain")}
          </Button>
        </div>
      ) : verifying ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-16 text-center" data-testid="checkout-verifying" role="status" aria-live="polite">
          <Spinner className="size-8 text-ember" />
          <div>
            <p className="text-h3">{t("verifying")}</p>
            <p className="mt-1 text-body-sm text-ink-2">{t("verifyingBody")}</p>
          </div>
        </div>
      ) : loading ? (
        <div className="flex flex-col gap-4" aria-busy="true">
          <div className="flex items-center gap-4">
            <div className="skeleton aspect-[4/5] w-[4.5rem] rounded-md" />
            <div className="flex flex-1 flex-col gap-2">
              <div className="skeleton h-4 w-4/5 rounded-full" />
              <div className="skeleton h-3 w-1/2 rounded-full" />
            </div>
          </div>
          <div className="skeleton mt-4 h-20 rounded-md" />
          <span className="sr-only">{t("loading")}</span>
        </div>
      ) : summary && !succeeded ? (
        <>
          {/* What you're paying for: the card itself, not a description of it. */}
          <section aria-labelledby="checkout-summary" className="flex items-center gap-4">
            <ThemeWorld
              themeKey={themeKey}
              opening={tt(`${themeKey}.opening`)}
              message={content.message ?? ""}
              fit
              className="w-[4.5rem] shrink-0 rounded-md shadow-sm"
            />
            <div className="min-w-0 flex-1">
              <h2 id="checkout-summary" className="sr-only">
                {t("summaryTitle")}
              </h2>
              <p className="line-clamp-2 font-serif text-[1.0625rem] leading-snug text-ink">{content.message}</p>
              <p className="mt-1 text-caption text-ink-3">{items.join(" · ")}</p>
            </div>
            <button
              type="button"
              onClick={onEdit}
              className="shrink-0 self-start text-label text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink"
            >
              {t("edit")}
            </button>
          </section>

          <section aria-label={t("total")} className="border-y border-line py-5">
            <div className="flex items-baseline justify-between gap-4 text-body-sm text-ink-2">
              <span>{t("activationLabel")}</span>
              <span className="tabular-nums">{amountLabel}</span>
            </div>
            <div className="mt-3 flex items-baseline justify-between gap-4">
              <span className="text-h3">{t("total")}</span>
              <span className="font-serif text-[2rem] leading-none tabular-nums" data-testid="checkout-amount">
                {amountLabel}
              </span>
            </div>
            <p className="mt-4 text-caption text-ink-3">
              {t("explanation")} {t("lock")}
            </p>
          </section>

          <section aria-labelledby="checkout-next">
            <h2 id="checkout-next" className="text-label text-ink-2">
              {t("nextTitle")}
            </h2>
            <ol className="mt-3 flex flex-col gap-2.5">
              {(["next1", "next2", "next3"] as const).map((k, i) => (
                <li key={k} className="flex gap-3 text-body-sm text-ink">
                  <span className="w-4 shrink-0 font-serif text-ink-3 tabular-nums">{i + 1}</span>
                  <span>{t(k)}</span>
                </li>
              ))}
            </ol>
          </section>

          <div className="flex items-center justify-between gap-4 text-label">
            <button
              type="button"
              onClick={onBackToPreview}
              className="text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink"
              data-testid="checkout-back-link"
            >
              {t("backToPreview")}
            </button>
            {isTestPayments && !failed && (
              <details className="text-right text-caption text-ink-3">
                <summary className="cursor-pointer list-none underline decoration-line-strong underline-offset-4" data-testid="checkout-testing-toggle">
                  {t("testingOptions")}
                </summary>
                <button
                  type="button"
                  onClick={() => pay("failure")}
                  disabled={paying}
                  className="mt-2 text-danger underline underline-offset-4 disabled:opacity-40"
                  data-testid="checkout-simulate-failure"
                >
                  {t("simulateFailure")}
                </button>
              </details>
            )}
          </div>

          <ActionBar
            note={
              isTestPayments ? (
                <span className="text-warning">{t("testMode")}</span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <Lock className="size-3" aria-hidden />
                  {t("secureNote")}
                </span>
              )
            }
          >
            {cancelled && (
              <Notice tone="warning">
                <span data-testid="payment-cancelled-message">{t("cancelledMessage")}</span>
              </Notice>
            )}
            {failed && (
              <Notice tone="danger">
                <span data-testid="payment-failed-message">{t("paymentFailed")}</span>
              </Notice>
            )}
            {error && <Notice tone="danger">{t("errorGeneric")}</Notice>}
            <Button
              size="lg"
              block
              onClick={() => (failed || cancelled ? retry() : isTestPayments ? pay("success") : payReal())}
              disabled={showRealPayButton && !summary.redirectUrl}
              loading={paying}
              loadingLabel={t("processing")}
              data-testid={failed || cancelled ? "checkout-retry" : "checkout-pay"}
            >
              {failed || cancelled ? t("retry") : isTestPayments ? t("payButton", { price: amountLabel ?? "" }) : t("payButtonReal", { price: amountLabel ?? "" })}
            </Button>
          </ActionBar>
        </>
      ) : succeeded ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-16 text-center" role="status" aria-live="polite">
          <Spinner className="size-8 text-success" />
          <p className="text-h3">{t("activating")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Notice tone="danger" title={t("errorTitle")}>
            {t("errorGeneric")}
          </Notice>
          <Button variant="secondary" size="lg" block onClick={retry}>
            {t("retry")}
          </Button>
        </div>
      )}
    </div>
  );
}
