"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent } from "react";
import { preload } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { SuccessIcon } from "@/components/customer/icons";
import { prefetchMotion } from "@/components/themes/scenes/runtime";
import { ThemeWorld } from "@/components/themes/theme-world";
import { Dock, SigAction } from "@/components/signature/chrome";
import { updateThemeAction } from "@/lib/greetings/actions";
import { tick } from "@/lib/client/haptics";
import { useChromeTint } from "@/lib/client/use-chrome-tint";
import type { ThemeKey } from "@/lib/themes/registry";
import { getThemeWorld, worldVars } from "@/lib/themes/worlds";
import { getCollection, getTemplate, restAssets } from "@/lib/templates/catalog";
import { roomVars } from "@/lib/templates/room";

/** The curated collection the picker offers, in its order (src/lib/templates/catalog.ts). */
const ORDER: ThemeKey[] = getCollection("launch").map((t) => t.id);

/** Selection is saved once the sender settles — not on every arrow-key step. */
const SAVE_DELAY_MS = 350;
/** Choices closer together than this are "rapid": worlds play their short choreography. */
const RAPID_MS = 700;
/** The paper the Signature sender screens are printed on (signature.css --sig-paper): the browser chrome matches it. */
const PAPER = "#f6f0e6";

const noSubscription = () => () => {};

/** A world's own room (ground, texture, glow) and palette as inline custom properties. */
function roomOf(key: ThemeKey) {
  const template = getTemplate(key)!;
  return { style: { ...roomVars(template.spec.room), ...worldVars(getThemeWorld(key)) } as CSSProperties, dark: template.spec.room.dark };
}

/**
 * Screen #2 in the Signature Experience — "How should it feel?". The chosen
 * world stands large in its own room (the room the recipient will open it
 * in); all six worlds sit beneath it in a named 3 × 2 grid, so nothing is
 * hidden off-screen on a compact phone.
 *
 * Behaviour is production's (the legacy gallery picker's model): the grid is
 * one radio group (arrows move the choice, only the chosen radio is in the
 * tab order); a choice is optimistic, saved shortly after it settles
 * (updateThemeAction), reverted with a notice if saving fails, and Continue
 * waits for the save. Tapping the hero replays the chosen world's moment.
 */
export function SignatureThemePicker({
  greetingId,
  selected,
  onSelect,
  onContinue,
}: {
  greetingId: string;
  selected: ThemeKey;
  onSelect: (key: ThemeKey) => void;
  onContinue: () => void;
}) {
  const t = useTranslations("wizard.theme");
  const tw = useTranslations("wizard");
  const ts = useTranslations("wizard.sig");
  const tt = useTranslations("themes");
  const locale = useLocale();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const waitingRef = useRef(false);
  // Mounted after hydration (arriving from Screen #1, or back from Words)
  // rather than hydrated from a direct load: only then does the chosen world
  // make an entrance; a direct load shows it at rest (its first paint is the LCP).
  const clientMount = useSyncExternalStore(noSubscription, () => true, () => false);
  const [entrance] = useState(clientMount);
  /** Bumped on each choice (and replay) so the hero's world plays its moment again. */
  const [beat, setBeat] = useState(entrance ? 1 : 0);
  const [motion, setMotion] = useState<"full" | "short">("full");
  const seenRef = useRef<Set<ThemeKey>>(new Set(entrance ? [selected] : []));
  const lastChoiceRef = useRef(0);
  /** The room we are leaving stays underneath while the new one fades in over it (opacity only). */
  const [prev, setPrev] = useState<ThemeKey>(selected);
  const savedRef = useRef<ThemeKey>(selected);
  const timerRef = useRef(0);
  const radiosRef = useRef<(HTMLButtonElement | null)[]>([]);

  const save = useCallback(
    (key: ThemeKey) => {
      window.clearTimeout(timerRef.current);
      setSaving(true);
      timerRef.current = window.setTimeout(async () => {
        const result = await updateThemeAction(greetingId, key).catch(() => null);
        const ok = !!result?.ok;
        if (!ok) {
          if (result && !result.ok) console.error("[updateTheme]", result.error);
          onSelect(savedRef.current);
          setError(true);
        } else {
          savedRef.current = key;
        }
        setSaving(false);
        if (waitingRef.current) {
          waitingRef.current = false;
          setWaiting(false);
          if (ok) onContinue();
        }
      }, SAVE_DELAY_MS);
    },
    [greetingId, onSelect, onContinue],
  );

  function handleContinue() {
    if (!saving) return onContinue();
    waitingRef.current = true;
    setWaiting(true);
  }

  function choose(key: ThemeKey) {
    if (key === selected) return;
    tick();
    const now = performance.now();
    const rapid = now - lastChoiceRef.current < RAPID_MS;
    lastChoiceRef.current = now;
    setMotion(rapid || seenRef.current.has(key) ? "short" : "full");
    seenRef.current.add(key);
    setError(false);
    setPrev(selected);
    onSelect(key);
    setBeat((b) => b + 1);
    save(key);
  }

  /** Watch the chosen world open again (a tap on the hero). */
  function replay() {
    setMotion("full");
    setBeat((b) => b + 1);
  }

  // Radiogroup keyboard model: arrows move the choice, Tab leaves the group.
  function onKeyDown(e: KeyboardEvent, index: number) {
    const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (index + delta + ORDER.length) % ORDER.length;
    choose(ORDER[next]!);
    radiosRef.current[next]?.focus();
  }

  /** Fetch a world's typefaces ahead of use: the chosen one at once, others on hover/focus. */
  function warmFonts(key: ThemeKey) {
    const { latin, georgian } = getThemeWorld(key).fontFiles;
    preload(latin, { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
    if (locale === "ka") preload(georgian, { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
  }

  // Warm the scene runtime while the sender looks, so the first choice plays at once.
  useEffect(() => prefetchMotion(), []);
  useEffect(() => () => window.clearTimeout(timerRef.current), []);
  useChromeTint(PAPER);

  // The chosen world's material and stills are discovered only after CSS and
  // layout — ask for them up front (scene footage loads only when a scene plays).
  for (const { asset, high } of restAssets(getTemplate(selected)!)) {
    preload(asset.href, { as: "image", type: asset.type, ...(high && { fetchPriority: "high" }), ...("crossOrigin" in asset && { crossOrigin: "anonymous" }) });
  }
  warmFonts(selected);

  const room = roomOf(selected);

  return (
    <div className="sigf-picker flex flex-1 flex-col" data-world={selected} data-room={room.dark ? "dark" : "light"} data-testid="theme-step">
      <h1 className="sig-title">{t("title")}</h1>
      <p className="sig-sub">{t("subtitle")}</p>

      {/* The hero is decorative (a mirror of the radio group); a tap replays the chosen world. */}
      <div className="sigf-hero" data-room={room.dark ? "dark" : "light"} onClick={replay} aria-hidden data-testid="theme-hero">
        <span className="sigf-hero__room" style={roomOf(prev).style} />
        <span key={selected} className="sigf-hero__room sigf-hero__room--in" style={room.style} data-testid="theme-hero-room" />
        <span className="sigf-hero__light" />
        <div key={`${selected}-${beat}`} className="sigf-hero__stage">
          <ThemeWorld
            themeKey={selected}
            opening={tt(`${selected}.opening`)}
            message={tt(`${selected}.sample`)}
            active={beat > 0}
            motion={motion}
            interactive
            className="sigf-hero__world"
          />
        </div>
        <p key={`name-${selected}`} className="sigf-hero__name" style={room.style}>
          <b>{tt(`${selected}.name`)}</b>
          <span>{tt(`${selected}.tagline`)}</span>
        </p>
      </div>

      {error && (
        <p className="sig-notice mt-3" role="alert">
          {t("saveError")}
        </p>
      )}

      <div className="sigf-worlds" role="radiogroup" aria-label={t("title")}>
        {ORDER.map((key, i) => {
          const active = key === selected;
          return (
            <button
              key={key}
              ref={(el) => {
                radiosRef.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              onClick={() => choose(key)}
              onPointerEnter={() => warmFonts(key)}
              onFocus={() => warmFonts(key)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className="sigf-tile"
              data-on={active || undefined}
              aria-label={tt(`${key}.name`)}
              aria-describedby={`theme-mood-${key}`}
              data-testid={`theme-option-${key}`}
            >
              <span className="sigf-tile__swatch" style={roomOf(key).style} aria-hidden>
                <ThemeWorld themeKey={key} opening="" message="" near={false} className="sigf-tile__world" />
                <span className="sigf-tile__check">
                  <SuccessIcon size={16} weight="fill" />
                </span>
              </span>
              <span className="sigf-tile__name" aria-hidden>
                {tt(`${key}.name`)}
              </span>
              <span id={`theme-mood-${key}`} className="sr-only">
                {tt(`${key}.tagline`)}
              </span>
            </button>
          );
        })}
      </div>
      {/* The choice is announced here, once (the hero is aria-hidden). */}
      <p className="sr-only" aria-live="polite">
        {ts("chosen")}: {tt(`${selected}.name`)}
      </p>

      <Dock>
        <SigAction onClick={handleContinue} busy={waiting} testId="wizard-continue">
          {tw("continue")}
        </SigAction>
      </Dock>
    </div>
  );
}
