"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { ArrowRight, Check, ChevronLeft, Lock, Pencil } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { ActionBar } from "@/components/flow/shell";
import { Button } from "@/components/ui/button";
import { TextArea } from "@/components/ui/field";
import { Logo } from "@/components/ui/logo";
import { Notice } from "@/components/ui/notice";
import { Spinner } from "@/components/ui/spinner";
import { formatMinorAmount } from "@/lib/format/money";
import { SELECTABLE_THEMES, getThemeConfig, type ThemeKey } from "@/lib/themes/registry";
import { updateThemeAction, updateMessageAction, viewPreviewAction } from "@/lib/greetings/actions";
import { startCheckoutAction, simulateTestPaymentAction, checkPaymentReturnAction } from "@/lib/payments/actions";
import type { CheckoutOrderSummary } from "@/lib/payments/checkout";
import { greetingMessageSchema, MESSAGE_MAX_LENGTH } from "@/lib/validation/greeting-text";
import { MediaUploadField } from "./media-upload-field";
import { VoiceRecorder } from "./voice-recorder";
import { GreetingRenderer, type GreetingRenderContent } from "./greeting-renderer";
import { LivePreview } from "./live-preview";
import { LocaleSwitcher } from "./locale-switcher";
import { ThemeSwatch } from "./theme-swatch";

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
        theme={getThemeConfig(themeKey)}
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
        {step === "checkout" ? (
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
          <div className="grid flex-1 gap-12 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-16 lg:pt-4">
            <div className="mx-auto flex w-full max-w-xl flex-col">
              <StepProgress index={wizardStepIndex} step={step} />
              {step === "theme" && (
                <ThemeStep
                  greetingId={initial.greetingId}
                  selected={themeKey}
                  onSelect={setThemeKey}
                  onContinue={() => goToStep("message")}
                />
              )}
              {step === "message" && (
                <MessageStep greetingId={initial.greetingId} message={message} onChange={setMessage} onContinue={() => goToStep("media")} />
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
            <aside className="hidden lg:block" aria-hidden>
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

function ThemeStep({ greetingId, selected, onSelect, onContinue }: { greetingId: string; selected: ThemeKey; onSelect: (k: ThemeKey) => void; onContinue: () => void }) {
  const t = useTranslations("wizard.theme");
  const tt = useTranslations("themes");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  async function choose(key: ThemeKey) {
    const previous = selected;
    onSelect(key);
    setSaving(true);
    setError(false);
    const result = await updateThemeAction(greetingId, key).catch(() => null);
    setSaving(false);
    if (!result?.ok) {
      if (result) logActionError("updateTheme", result.error);
      onSelect(previous);
      setError(true);
    }
  }

  // Radiogroup keyboard model: arrows move selection, Tab leaves the group.
  function onKeyDown(e: React.KeyboardEvent, index: number) {
    const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (index + delta + SELECTABLE_THEMES.length) % SELECTABLE_THEMES.length;
    void choose(SELECTABLE_THEMES[next]!.key);
    refs.current[next]?.focus();
  }

  return (
    <StepShell title={t("title")} subtitle={t("subtitle")} onContinue={onContinue} continueDisabled={saving}>
      {error && (
        <Notice tone="danger" className="mb-6">
          {t("saveError")}
        </Notice>
      )}
      <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3" data-testid="theme-step" role="radiogroup" aria-label={t("title")}>
        {SELECTABLE_THEMES.map((theme, i) => {
          const active = selected === theme.key;
          return (
            <button
              key={theme.key}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              onClick={() => choose(theme.key)}
              onKeyDown={(e) => onKeyDown(e, i)}
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              className="group flex flex-col gap-2.5 text-left outline-none"
              data-testid={`theme-option-${theme.key}`}
            >
              <span
                className={`relative block overflow-hidden rounded-[var(--radius-lg)] transition-[box-shadow,transform] duration-200 group-active:scale-[0.98] group-focus-visible:ring-2 group-focus-visible:ring-ember group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-paper ${
                  active ? "shadow-md ring-2 ring-ink ring-offset-2 ring-offset-paper" : "shadow-xs ring-1 ring-line group-hover:shadow-sm"
                }`}
              >
                <ThemeSwatch themeKey={theme.key} className="aspect-[4/5]" envelopeWidth="70%" />
                {active && (
                  <span className="animate-pop absolute top-2.5 right-2.5 grid size-7 place-items-center rounded-full bg-ink text-white shadow-sm">
                    <Check className="size-4" strokeWidth={2.5} aria-hidden />
                  </span>
                )}
              </span>
              <span className="flex flex-col gap-0.5 px-0.5">
                <span className="text-label text-ink">{tt(`${theme.key}.name`)}</span>
                <span className="text-caption leading-snug text-ink-3">{tt(`${theme.key}.tagline`)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </StepShell>
  );
}

function MessageStep({ greetingId, message, onChange, onContinue }: { greetingId: string; message: string; onChange: (v: string) => void; onContinue: () => void }) {
  const t = useTranslations("wizard.message");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const limit = MESSAGE_MAX_LENGTH;

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

  return (
    <StepShell title={t("title")} subtitle={t("subtitle")} onContinue={handleContinue} continueLoading={saving}>
      <TextArea
        id="greeting-message"
        label={t("label")}
        value={message}
        onChange={(e) => {
          onChange(e.target.value.slice(0, limit));
          if (error && e.target.value.trim()) setError(null);
        }}
        placeholder={t("placeholder")}
        rows={8}
        autoCapitalize="sentences"
        error={error ?? undefined}
        hint={t("hint")}
        meta={
          <span className={remaining <= 60 ? "text-warning" : undefined}>
            {message.length}/{limit}
          </span>
        }
        className="min-h-56 font-serif text-[1.1875rem] leading-relaxed"
        data-testid="message-textarea"
      />
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
      chrome={
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex h-9 items-center gap-1 rounded-full bg-black/35 pr-3.5 pl-2 text-label text-white backdrop-blur-md transition-colors hover:bg-black/50"
          >
            <ChevronLeft className="size-4" aria-hidden />
            {t("editShort")}
          </button>
          <span className="inline-flex h-7 items-center rounded-full bg-white/85 px-3 text-caption font-medium text-ink shadow-xs backdrop-blur-md">
            {t("badge")}
          </span>
        </div>
      }
      senderControls={
        <div
          className="w-full max-w-sm rounded-[var(--radius-lg)] bg-surface p-5 text-left text-ink shadow-lg ring-1 ring-black/5"
          data-testid="preview-sender-controls"
        >
          <p className="text-h3">{t("readyTitle")}</p>
          <p className="mt-1 text-body-sm text-ink-2">{t("readyBody")}</p>
          <div className="mt-4 flex flex-col gap-2">
            {priceLabel ? (
              <Button size="lg" block onClick={onCheckout} iconEnd={<ArrowRight className="size-4" aria-hidden />} data-testid="preview-activate-cta">
                {t("activate", { price: priceLabel })}
              </Button>
            ) : (
              <Notice tone="danger">
                <span data-testid="preview-price-unavailable">{t("priceUnavailable")}</span>
              </Notice>
            )}
            <Button variant="ghost" size="md" block onClick={onEdit} icon={<Pencil className="size-4" aria-hidden />} data-testid="preview-edit">
              {t("edit")}
            </Button>
          </div>
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

    (async () => {
      for (let attempt = 0; attempt < RETURN_POLL_ATTEMPTS; attempt++) {
        const result = await checkPaymentReturnAction(greetingId).catch(() => null);
        if (!result?.ok) {
          if (result) logActionError("checkPaymentReturn", result.error);
          setVerifying(false);
          setError(true);
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
    <div className="animate-rise flex flex-1 flex-col gap-8 pt-4" data-testid="checkout-step">
      <header>
        <h1 className="text-h1">{t("title")}</h1>
        <p className="mt-2 text-body text-ink-2">{t("subtitle")}</p>
      </header>

      {verifying ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-16 text-center" data-testid="checkout-verifying" role="status" aria-live="polite">
          <Spinner className="size-8 text-ember" />
          <div>
            <p className="text-h3">{t("verifying")}</p>
            <p className="mt-1 text-body-sm text-ink-2">{t("verifyingBody")}</p>
          </div>
        </div>
      ) : loading ? (
        <div className="flex flex-col gap-4" aria-busy="true">
          <div className="skeleton h-36 rounded-[var(--radius-lg)]" />
          <div className="skeleton h-5 w-1/2 rounded-full" />
          <div className="skeleton h-8 w-1/3 rounded-full" />
          <span className="sr-only">{t("loading")}</span>
        </div>
      ) : summary && !succeeded ? (
        <>
          <section aria-labelledby="checkout-summary" className="rounded-[var(--radius-lg)] bg-surface p-4 shadow-xs ring-1 ring-line sm:p-5">
            <div className="flex items-start gap-4">
              <ThemeSwatch themeKey={themeKey} className="aspect-[4/5] w-20 shrink-0 rounded-md" envelopeWidth="74%" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 id="checkout-summary" className="text-caption text-ink-3">
                    {t("summaryTitle")}
                  </h2>
                  <button type="button" onClick={onEdit} className="text-label text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
                    {t("edit")}
                  </button>
                </div>
                <p className="mt-1.5 line-clamp-3 font-serif text-[1.0625rem] leading-snug text-ink">{content.message}</p>
              </div>
            </div>
            <ul className="mt-4 flex flex-wrap gap-1.5 border-t border-line pt-4">
              {items.map((label) => (
                <li key={label} className="rounded-full bg-sunken px-2.5 py-1 text-caption text-ink-2">
                  {label}
                </li>
              ))}
            </ul>
          </section>

          <section aria-label={t("total")} className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-4 text-body">
              <span className="text-ink-2">{t("activationLabel")}</span>
              <span className="tabular-nums">{amountLabel}</span>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-t border-line pt-3">
              <span className="text-h3">{t("total")}</span>
              <span className="text-h2 tabular-nums" data-testid="checkout-amount">
                {amountLabel}
              </span>
            </div>
            <p className="text-caption text-ink-3">{t("explanation")}</p>
          </section>

          <section aria-labelledby="checkout-next">
            <h2 id="checkout-next" className="text-h3">
              {t("nextTitle")}
            </h2>
            <ol className="mt-4 flex flex-col gap-4">
              {(["next1", "next2", "next3"] as const).map((k, i) => (
                <li key={k} className="flex gap-3.5">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-ember-soft text-caption font-medium text-ember-ink">
                    {i + 1}
                  </span>
                  <span className="pt-0.5 text-body-sm text-ink-2">{t(k)}</span>
                </li>
              ))}
            </ol>
          </section>

          <div className="flex flex-col gap-3">
            <Notice tone="info">{t("lock")}</Notice>
            {isTestPayments && <Notice tone="warning">{t("testMode")}</Notice>}
          </div>

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

          <ActionBar>
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
              icon={failed || cancelled ? undefined : <Lock className="size-4" aria-hidden />}
              data-testid={failed || cancelled ? "checkout-retry" : "checkout-pay"}
            >
              {failed || cancelled
                ? t("retry")
                : isTestPayments
                  ? t("payButton", { price: amountLabel ?? "" })
                  : t("payButtonReal", { price: amountLabel ?? "" })}
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
