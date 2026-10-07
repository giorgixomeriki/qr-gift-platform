"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { createPortal, preload } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { ActionBar } from "@/components/flow/shell";
import { PrimaryAction } from "@/components/customer/primary-action";
import { prefetchMotion } from "@/components/themes/scenes/runtime";
import { ThemeSeal, ThemeWorld } from "@/components/themes/theme-world";
import { Notice } from "@/components/ui/notice";
import { updateThemeAction } from "@/lib/greetings/actions";
import type { ThemeKey } from "@/lib/themes/registry";
import { getThemeWorld } from "@/lib/themes/worlds";
import { getCollection, getTemplate, restAssets } from "@/lib/templates/catalog";
import { roomCss } from "@/lib/templates/room";
import "./theme-picker.css";

/** The curated collection the picker offers, in its order (src/lib/templates/catalog.ts). */
const COLLECTION = getCollection("launch");
const ORDER: ThemeKey[] = COLLECTION.map((t) => t.id);
/** Each template's room as CSS, generated once from its tokens. */
const ROOM_CSS = roomCss(COLLECTION);

/** Selection is saved once the sender settles — not on every slide a swipe passes. */
const SAVE_DELAY_MS = 350;
/** Choices closer together than this are "rapid": worlds play their short choreography. */
const RAPID_MS = 700;
/** How long the outgoing world (stage and room) stays under the incoming one while it is revealed. */
const ARRIVAL_MS = 1250;

const noSubscription = () => () => {};

/**
 * Screen #2 — "How should it feel?": the theme picker as a choice of
 * emotional worlds, each previewed as the recipient will meet it (its real
 * opening line, a sample message, the world's own type, material and
 * artwork — components/themes/theme-world.tsx).
 *
 * Phones (and tablets): a swipeable gallery of worlds, neighbours peeking,
 * the world that comes to rest is the one chosen; a row of six seals below
 * jumps to any world directly. Desktop: the six worlds as an editorial list
 * beside one large stage. Either way the accessible control is one radio
 * group (the seals / list rows): arrows move the choice, Tab leaves the
 * group. The gallery and stage are decorative mirrors of it.
 *
 * Motion (docs/design/QR-STARR-MOTION-LANGUAGE.md): choosing a world plays
 * its signature moment — in full the first time, short when it has been
 * seen or the sender is switching quickly; choosing the current world
 * replays nothing. Arriving from Screen #1 plays the chosen world's entrance;
 * a direct load of the step shows it at rest (its first paint is the page's
 * LCP). Each world arrives in its own grammar — through light (Romantic),
 * vellum (Wedding), paper (Birthday), ignition (Celebration), an aperture
 * (Elegant), a line of type (Minimal) — on the desktop stage over the old
 * world, and in the room: the whole screen takes on the chosen world
 * (body:has(.tp[data-world]) in theme-picker.css), so the sender is inside
 * it rather than looking at a card. On phones the gallery tracks the finger.
 *
 * Tapping the chosen world itself (gallery or stage) plays its signature
 * again, in full — the preview is there to be watched; the seals never
 * replay, so a stray tap on the current choice stays quiet.
 *
 * Choosing is optimistic; the choice is saved shortly after it settles
 * (updateThemeAction), reverted with a notice if saving fails, and the
 * action waits until it is saved.
 */
export function ThemePicker({
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
  const tt = useTranslations("themes");
  const locale = useLocale();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  /** The sender pressed the action while a choice was still being saved. */
  const [waiting, setWaiting] = useState(false);
  const waitingRef = useRef(false);
  // Mounted after hydration (arriving from Screen #1) rather than hydrated
  // from a direct load: only then does the chosen world make an entrance.
  const clientMount = useSyncExternalStore(noSubscription, () => true, () => false);
  const [entrance] = useState(clientMount);
  /** Bumped on each choice so the selected world replays its motion. */
  const [beat, setBeat] = useState(entrance ? 1 : 0);
  const [motion, setMotion] = useState<"full" | "short">("full");
  const seenRef = useRef<Set<ThemeKey>>(new Set(entrance ? [selected] : []));
  const lastChoiceRef = useRef(0);
  /** Desktop stage: the world being covered by the new one. */
  const [leaving, setLeaving] = useState<ThemeKey | null>(null);
  const leavingTimerRef = useRef(0);
  const savedRef = useRef<ThemeKey>(selected);
  const timerRef = useRef<number>(0);
  const radiosRef = useRef<(HTMLButtonElement | null)[]>([]);
  const galleryRef = useRef<HTMLDivElement>(null);
  const programmaticRef = useRef(false);
  const [near, setNear] = useState<Set<ThemeKey>>(() => new Set([selected]));

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

  const choose = useCallback(
    (key: ThemeKey, { scroll = true }: { scroll?: boolean } = {}) => {
      if (scroll) scrollToWorld(key, "smooth");
      if (key === selected) return;
      const now = performance.now();
      const rapid = now - lastChoiceRef.current < RAPID_MS;
      lastChoiceRef.current = now;
      setMotion(rapid || seenRef.current.has(key) ? "short" : "full");
      seenRef.current.add(key);
      window.clearTimeout(leavingTimerRef.current);
      setLeaving(selected);
      leavingTimerRef.current = window.setTimeout(() => setLeaving(null), ARRIVAL_MS);
      setError(false);
      onSelect(key);
      setBeat((b) => b + 1);
      save(key);
    },
    [selected, onSelect, save],
  );

  /** Watch the chosen world open again (a tap on the world itself). */
  function replay() {
    window.clearTimeout(leavingTimerRef.current);
    setLeaving(null);
    setMotion("full");
    setBeat((b) => b + 1);
  }

  function scrollToWorld(key: ThemeKey, behavior: ScrollBehavior) {
    const gallery = galleryRef.current;
    const slide = gallery?.querySelector<HTMLElement>(`[data-world="${key}"]`);
    if (!gallery || !slide || gallery.offsetParent === null) return;
    programmaticRef.current = true;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    gallery.scrollTo({ left: slide.offsetLeft - (gallery.clientWidth - slide.clientWidth) / 2, behavior: reduce ? "auto" : behavior });
  }

  // Open the gallery on the current choice. Until hydration the server render
  // shows only the chosen world (CSS, :not([data-ready])) — otherwise the
  // first world in the gallery would stand in for it until JS could scroll.
  // Before the first client paint: reveal the neighbours and scroll to it.
  useLayoutEffect(() => {
    const gallery = galleryRef.current;
    if (gallery) gallery.dataset.ready = "";
    scrollToWorld(selected, "auto");
    programmaticRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The world that comes to rest in the middle of the gallery is the choice.
  useEffect(() => {
    const gallery = galleryRef.current;
    if (!gallery) return;
    let timer = 0;
    const settle = () => {
      window.clearTimeout(timer);
      if (programmaticRef.current) {
        programmaticRef.current = false;
        return;
      }
      const mid = gallery.scrollLeft + gallery.clientWidth / 2;
      let best: ThemeKey | null = null;
      let bestDist = Infinity;
      for (const slide of gallery.querySelectorAll<HTMLElement>("[data-world]")) {
        const d = Math.abs(slide.offsetLeft + slide.clientWidth / 2 - mid);
        if (d < bestDist) {
          bestDist = d;
          best = slide.dataset.world as ThemeKey;
        }
      }
      if (best) choose(best, { scroll: false });
    };
    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(settle, 140); // fallback where scrollend is unsupported
    };
    gallery.addEventListener("scroll", onScroll, { passive: true });
    gallery.addEventListener("scrollend", settle);
    return () => {
      window.clearTimeout(timer);
      gallery.removeEventListener("scroll", onScroll);
      gallery.removeEventListener("scrollend", settle);
    };
  }, [choose]);

  // A world's typefaces load only as it approaches the viewport — and the
  // neighbours' only once the page is idle, so they never compete with the
  // first paint (the chosen world's faces come first).
  useEffect(() => {
    const gallery = galleryRef.current;
    if (!gallery || !("IntersectionObserver" in window)) return;
    let io: IntersectionObserver | undefined;
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1200));
    const cancelIdle = window.cancelIdleCallback ?? window.clearTimeout;
    const handle = idle(() => {
      io = new IntersectionObserver(
        (entries) => {
          setNear((prev) => {
            const next = new Set(prev);
            for (const e of entries) if (e.isIntersecting) next.add((e.target as HTMLElement).dataset.world as ThemeKey);
            return next.size === prev.size ? prev : next;
          });
        },
        { root: gallery, rootMargin: "0px 60% 0px 60%" },
      );
      gallery.querySelectorAll("[data-world]").forEach((el) => io!.observe(el));
    });
    return () => {
      cancelIdle(handle);
      io?.disconnect();
    };
  }, []);

  /** Fetch a world's typefaces ahead of use: the chosen one at once, others on hover/focus. */
  function warmFonts(key: ThemeKey) {
    const { latin, georgian } = getThemeWorld(key).fontFiles;
    preload(latin, { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
    if (locale === "ka") preload(georgian, { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
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

  // Warm the scene runtime while the sender looks, so the first choice plays at once.
  useEffect(() => prefetchMotion(), []);

  // The room's arrival layers live on <body>, outside the picker's own entrance transform.
  const [roomHost, setRoomHost] = useState<HTMLElement | null>(null);
  useEffect(() => setRoomHost(document.body), []);

  useEffect(
    () => () => {
      window.clearTimeout(timerRef.current);
      window.clearTimeout(leavingTimerRef.current);
    },
    [],
  );

  // The chosen world's ground is the screen's largest paint; its material,
  // light and scene stills are discovered only after CSS and layout, so ask
  // for them up front (its composition's rest assets — scene footage loads
  // only when a scene plays). Its faces use font-display: fallback — found
  // late on a slow connection they could miss the swap window.
  for (const { asset, high } of restAssets(getTemplate(selected)!)) {
    preload(asset.href, { as: "image", type: asset.type, ...(high && { fetchPriority: "high" }), ...("crossOrigin" in asset && { crossOrigin: "anonymous" }) });
  }
  warmFonts(selected);

  const name = tt(`${selected}.name`);
  const composition = getThemeWorld(selected).composition;
  const roomDark = getTemplate(selected)!.spec.room.dark;

  return (
    <div
      className="tp animate-rise flex flex-1 flex-col pt-6 lg:grid lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-x-16 lg:pt-4"
      data-live={beat > 0 || undefined}
      data-world={selected}
      data-room={roomDark ? "dark" : "light"}
      data-testid="theme-step"
    >
      <style>{ROOM_CSS}</style>
      {roomHost &&
        leaving &&
        leaving !== selected &&
        createPortal(
          <div className="tp-room" aria-hidden>
            <div className={`tp-room__layer tp-room__layer--${leaving}`} />
            <div key={`${selected}-${beat}`} className={`tp-room__layer tp-room__layer--${selected}`} data-enter={composition} />
          </div>,
          roomHost,
        )}
      <div className="flex flex-col lg:col-start-1 lg:row-start-1">
        <h1 className="text-h1">{t("title")}</h1>
        <p className="tp__subtitle mt-2 text-body text-ink-2">{t("subtitle")}</p>
      </div>

      {/* Phones/tablets: the gallery of worlds. Decorative mirror of the radio group below. */}
      <div
        ref={galleryRef}
        className="tp__gallery -mx-4 mt-5 sm:-mx-6 lg:hidden [@media(max-height:760px)]:mt-3"
        aria-hidden
        data-testid="theme-gallery"
      >
        {ORDER.map((key) => (
          <div key={key} className="tp__slide" data-world={key} data-selected={key === selected || undefined} onClick={() => (key === selected ? replay() : choose(key))}>
            <ThemeWorld
              key={key === selected ? `${key}-${beat}` : key}
              themeKey={key}
              opening={tt(`${key}.opening`)}
              message={tt(`${key}.sample`)}
              active={key === selected && beat > 0}
              motion={motion}
              near={near.has(key)}
              interactive={key === selected}
              className="tp__world"
            />
          </div>
        ))}
      </div>

      {/* Desktop: one large stage for the chosen world. */}
      <div className="tp__stage hidden lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:flex" aria-hidden>
        <p className="tp__stage-label">{t("previewLabel")}</p>
        <div className="tp__stage-frame" onClick={replay}>
          {leaving && leaving !== selected && (
            <ThemeWorld
              key={`leaving-${leaving}`}
              themeKey={leaving}
              opening={tt(`${leaving}.opening`)}
              message={tt(`${leaving}.sample`)}
              className="tp__stage-world tp__stage-world--leaving"
            />
          )}
          <ThemeWorld
            key={`${selected}-${beat}`}
            themeKey={selected}
            opening={tt(`${selected}.opening`)}
            message={tt(`${selected}.sample`)}
            active={beat > 0}
            motion={motion}
            interactive
            className={`tp__stage-world ${leaving ? `tp__stage-world--enter tp-enter--${composition}` : ""}`}
          />
        </div>
      </div>

      <div className="flex flex-col lg:col-start-1 lg:row-start-2">
        <p className="tp__now mt-2 text-center lg:hidden" aria-hidden>
          <span className="tp__now-name">{name}</span>
          <span className="tp__now-mood">{tt(`${selected}.tagline`)}</span>
        </p>

        {error && (
          <Notice tone="danger" className="mt-4">
            {t("saveError")}
          </Notice>
        )}

        <div className="tp__choices" role="radiogroup" aria-label={t("title")}>
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
                className="tp__choice"
                aria-label={tt(`${key}.name`)}
                aria-describedby={`theme-mood-${key}`}
                data-testid={`theme-option-${key}`}
              >
                <span className="tp__seal">
                  <ThemeSeal themeKey={key} />
                </span>
                <span className="tp__choice-text" aria-hidden>
                  <span className="tp__choice-name">{tt(`${key}.name`)}</span>
                  <span className="tp__choice-mood" id={`theme-mood-${key}`}>
                    {tt(`${key}.tagline`)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* contents on phones: the bar stays sticky to the whole step, not to this wrapper. */}
      <div className="tp__action contents lg:col-start-1 lg:row-start-3 lg:mt-8 lg:block">
        <ActionBar>
          <PrimaryAction onClick={handleContinue} loading={waiting} data-testid="wizard-continue">
            {tw("continue")}
          </PrimaryAction>
        </ActionBar>
      </div>
    </div>
  );
}
