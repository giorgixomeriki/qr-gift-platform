"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { EditIcon, ErrorIcon, PhotoIcon, PlayIcon } from "@/components/customer/icons";
import { BackButton, Brand, Dock, Mast, SealedEnvelope, SigAction, SigRoot, Steps } from "@/components/signature/chrome";
import { ThemeWorld } from "@/components/themes/theme-world";
import { updateMessageAction, viewPreviewAction } from "@/lib/greetings/actions";
import { getTemplate } from "@/lib/templates/catalog";
import { roomVars } from "@/lib/templates/room";
import type { ThemeKey } from "@/lib/themes/registry";
import { getThemeWorld, worldVars } from "@/lib/themes/worlds";
import { greetingMessageSchema, MESSAGE_MAX_LENGTH } from "@/lib/validation/greeting-text";
import { CheckoutStep, PreviewStep, WizardHeader, type WizardInitialState } from "./creation-wizard";
import { clearMessageBackup, readMessageBackup, writeMessageBackup } from "./message-backup";
import type { GreetingRenderContent } from "./greeting-renderer";
import { SignatureCreateStep } from "./signature-create-step";
import { SignatureThemePicker } from "./signature-theme-picker";
import { useMediaUploads } from "./use-media-uploads";

/**
 * The sender's steps in the Signature Experience. "message" and "media" are
 * the legacy wizard's two steps, now one Create screen: links, bookmarks,
 * the server's own redirect (?step=message when a message is missing) and
 * history entries made by the old wizard all still land there.
 */
const STEPS = ["theme", "create", "message", "media", "preview", "checkout"] as const;
type Step = (typeof STEPS)[number];
const CREATE_ALIASES: readonly Step[] = ["create", "message", "media"];

/** Typing settles for this long before the draft's message is saved (only a valid, changed message is sent). */
const AUTOSAVE_MS = 1500;

function logActionError(scope: string, error: string) {
  console.error(`[${scope}]`, error);
}

/**
 * The Signature Experience sender flow (approved Final Polish design),
 * connected to the real draft: the theme is saved by updateThemeAction, the
 * message by updateMessageAction (kept on the device until the server has
 * it), attachments through the real signed-upload pipeline. Preview and
 * checkout keep production's behaviour — the recipient view is the real
 * renderer, and checkout is unchanged in this phase.
 *
 * Steps are one client-side screen each, changed through the History API
 * (Back / Android's back gesture restore the previous step) — the same model
 * as the legacy wizard (creation-wizard.tsx).
 */
export function SignatureWizard({ initial }: { initial: WizardInitialState }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const raw = searchParams.get("step") as Step | null;
  const step: Step = raw && STEPS.includes(raw) ? raw : "theme";
  const watching = step === "preview" && searchParams.get("view") === "recipient";
  const tm = useTranslations("wizard.message");

  const [themeKey, setThemeKey] = useState<ThemeKey>(initial.themeKey);
  const [message, setMessage] = useState(initial.message);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savedMessageRef = useRef(initial.message);
  const media = useMediaUploads(initial.greetingId, initial);

  const goToStep = useCallback(
    (next: Step, params: Record<string, string> = {}) => {
      const search = new URLSearchParams(window.location.search);
      search.set("step", next);
      search.delete("payment");
      search.delete("view");
      for (const [k, v] of Object.entries(params)) search.set(k, v);
      window.history.pushState(null, "", `${pathname}?${search.toString()}`);
    },
    [pathname],
  );

  // Each step is a new screen: start it at the top.
  const firstStepRef = useRef(true);
  useEffect(() => {
    if (firstStepRef.current) {
      firstStepRef.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
  }, [step, watching]);

  // A message typed but never saved (the tab was discarded while the sender
  // was in another app) comes back from the device's copy — on the steps
  // before Preview. From Preview on, the server's copy is what's shown and
  // activated, so the two can never differ.
  useEffect(() => {
    if (step !== "theme" && !CREATE_ALIASES.includes(step)) return;
    const backup = readMessageBackup(initial.greetingId);
    if (backup !== null && backup !== initial.message) setMessage(backup);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveMessage = useCallback(
    async (value: string) => {
      const result = await updateMessageAction(initial.greetingId, value).catch(() => null);
      if (!result?.ok) {
        if (result) logActionError("updateMessage", result.error);
        return false;
      }
      savedMessageRef.current = value;
      // Only forget the device's copy if it still says what the server now has.
      if (readMessageBackup(initial.greetingId) === value) clearMessageBackup(initial.greetingId);
      return true;
    },
    [initial.greetingId],
  );

  const changeMessage = useCallback(
    (value: string) => {
      setMessage(value);
      writeMessageBackup(initial.greetingId, value);
    },
    [initial.greetingId],
  );

  // Draft autosave: a valid, changed message reaches the server once typing settles, so the
  // draft holds it even if the sender never presses Continue (another device, a cleared browser).
  useEffect(() => {
    if (message === savedMessageRef.current || !greetingMessageSchema.safeParse(message).success) return;
    const timer = window.setTimeout(() => void saveMessage(message), AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [message, saveMessage]);

  /** Create → Preview: the letter is required; removals are committed and the message saved before Preview reads them. */
  const continueFromCreate = useCallback(async () => {
    const trimmed = message.trim();
    if (!trimmed) return setMessageError(tm("errorEmpty"));
    if (trimmed.length > MESSAGE_MAX_LENGTH) return setMessageError(tm("errorTooLong", { limit: MESSAGE_MAX_LENGTH }));
    if (!greetingMessageSchema.safeParse(message).success) return setMessageError(tm("errorEmpty"));
    setMessageError(null);
    setSaving(true);
    const removed = await media.flushRemovals();
    const saved = removed && (message === savedMessageRef.current || (await saveMessage(message)));
    setSaving(false);
    if (!removed) return;
    if (!saved) return setMessageError(tm("errorSave"));
    goToStep("preview");
  }, [message, media, saveMessage, goToStep, tm]);

  const leaveCreate = useCallback(
    (to: Step) => {
      void media.flushRemovals();
      goToStep(to);
    },
    [media, goToStep],
  );

  const content: GreetingRenderContent = { message: message.trim() || null, ...media.content };

  if (step === "checkout") {
    // Checkout keeps its production visuals until the pricing-and-checkout phase.
    return (
      <div className="flex min-h-dvh w-full flex-col">
        <WizardHeader step="checkout" wizardStepIndex={-1} onBack={() => goToStep("preview")} />
        <main className="px-page mx-auto flex w-full max-w-5xl flex-1 flex-col">
          <div className="mx-auto flex w-full max-w-xl flex-1 flex-col">
            <CheckoutStep
              greetingId={initial.greetingId}
              isTestPayments={initial.isTestPayments}
              themeKey={themeKey}
              content={content}
              onBackToPreview={() => goToStep("preview")}
              onEdit={() => goToStep("create")}
            />
          </div>
        </main>
      </div>
    );
  }

  if (watching) {
    // "See it as the recipient": the real renderer, exactly what they'll receive; its own Activate waits at the ending.
    return (
      <PreviewStep
        greetingId={initial.greetingId}
        themeKey={themeKey}
        content={content}
        priceLabel={initial.priceLabel}
        recordView={false}
        onEdit={() => goToStep("preview")}
        onCheckout={() => goToStep("checkout")}
      />
    );
  }

  return (
    <SigRoot>
      <main className="sig-page">
        {step === "theme" ? (
          <>
            <Mast start={<Brand />} />
            <StepRow step="theme" />
            <SignatureThemePicker greetingId={initial.greetingId} selected={themeKey} onSelect={setThemeKey} onContinue={() => goToStep("create")} />
          </>
        ) : step === "preview" ? (
          <>
            <Mast start={<BackButton onClick={() => goToStep("create")} />} />
            <StepRow step="preview" />
            <SignaturePreview
              greetingId={initial.greetingId}
              themeKey={themeKey}
              content={content}
              priceLabel={initial.priceLabel}
              onWatch={() => goToStep("preview", { view: "recipient" })}
              onEditText={() => goToStep("create")}
              onEditDesign={() => goToStep("theme")}
              onCheckout={() => goToStep("checkout")}
            />
          </>
        ) : (
          <>
            <Mast start={<BackButton onClick={() => leaveCreate("theme")} />} />
            <StepRow step="create" />
            <SignatureCreateStep
              themeKey={themeKey}
              message={message}
              onMessageChange={changeMessage}
              limit={MESSAGE_MAX_LENGTH}
              messageError={messageError}
              onClearError={() => setMessageError(null)}
              media={media}
              saving={saving}
              onContinue={() => void continueFromCreate()}
            />
          </>
        )}
      </main>
    </SigRoot>
  );
}

function StepRow({ step }: { step: "theme" | "create" | "preview" }) {
  return (
    <div className="sig-steprow">
      <Steps step={step} />
    </div>
  );
}

/**
 * Preview in the Signature Experience: the recipient's room in miniature
 * with the sealed envelope (a tap opens the real recipient view), what the
 * greeting holds, quick ways back to each part, and Activate at the server's
 * price. PREVIEW_VIEWED is recorded once, here.
 */
function SignaturePreview({
  greetingId,
  themeKey,
  content,
  priceLabel,
  onWatch,
  onEditText,
  onEditDesign,
  onCheckout,
}: {
  greetingId: string;
  themeKey: ThemeKey;
  content: GreetingRenderContent;
  priceLabel: string | null;
  onWatch: () => void;
  onEditText: () => void;
  onEditDesign: () => void;
  onCheckout: () => void;
}) {
  const t = useTranslations("wizard.preview");
  const ts = useTranslations("wizard.sig");
  const tt = useTranslations("themes");
  const recordedRef = useRef(false);
  useEffect(() => {
    if (recordedRef.current) return;
    recordedRef.current = true;
    void viewPreviewAction(greetingId);
  }, [greetingId]);

  const template = getTemplate(themeKey)!;
  const roomStyle = { ...roomVars(template.spec.room), ...worldVars(getThemeWorld(themeKey)) } as CSSProperties;
  const items = [
    content.message ? ts("itemsText") : null,
    content.photos.length ? ts("itemsPhotos", { count: content.photos.length }) : null,
    content.video ? ts("itemsVideo") : null,
    content.audio ? ts("itemsVoice") : null,
  ].filter(Boolean) as string[];

  return (
    <div className="flex flex-1 flex-col" data-testid="preview-step">
      <h1 className="sig-title">{ts("previewTitle")}</h1>
      <p className="sig-sub">{ts("previewLede")}</p>

      {/* The recipient's room in miniature, the stationery envelope inside it. */}
      <button type="button" className="sig-window" style={roomStyle} data-room={template.spec.room.dark ? "dark" : "light"} onClick={onWatch} data-testid="preview-watch">
        <span className="sig-window__line">{tt(`${themeKey}.opening`)}</span>
        <SealedEnvelope small />
        <span className="sig-window__cta">
          <PlayIcon size={14} weight="fill" aria-hidden />
          {ts("watch")}
        </span>
      </button>
      <p className="sig-contents" data-testid="preview-contents">
        {ts("contents", { items: items.join(" · ") })}
      </p>

      <nav className="sig-edits" aria-label={ts("editNav")}>
        <button type="button" onClick={onEditText} data-testid="preview-edit">
          <EditIcon size={16} aria-hidden />
          {ts("editText")}
        </button>
        <button type="button" onClick={onEditText} data-testid="preview-edit-media">
          <PhotoIcon size={16} aria-hidden />
          {ts("editMedia")}
        </button>
        <button type="button" onClick={onEditDesign} data-testid="preview-edit-design">
          <span className="sig-edits__swatch" aria-hidden>
            <ThemeWorld themeKey={themeKey} opening="" message="" near={false} className="sig-edits__world" />
          </span>
          {ts("editDesign")}
        </button>
      </nav>

      <Dock>
        {priceLabel ? (
          <SigAction onClick={onCheckout} testId="preview-activate-cta">
            {t("activate", { price: priceLabel })}
          </SigAction>
        ) : (
          <p className="sig-notice" role="alert" data-testid="preview-price-unavailable">
            <ErrorIcon size={16} weight="fill" aria-hidden />
            {t("priceUnavailable")}
          </p>
        )}
      </Dock>
    </div>
  );
}
