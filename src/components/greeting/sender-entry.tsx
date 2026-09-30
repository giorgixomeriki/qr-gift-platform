"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { FlowShell } from "@/components/flow/shell";
import { EntryScene } from "@/components/customer/entry-scene";
import { PhotoIcon, TextIcon, VideoIcon, VoiceIcon } from "@/components/customer/icons";
import { PrimaryAction } from "@/components/customer/primary-action";
import { StarrEmboss } from "@/components/customer/starr-emboss";
import { Notice } from "@/components/ui/notice";
import { startGreetingAction } from "@/lib/greetings/actions";
import { LocaleSwitcher } from "./locale-switcher";

/** Entrance order for the content column (ms) — all of it usable within the first moment. */
const delay = (ms: number) => ({ "--cx-delay": `${ms}ms` }) as CSSProperties;

/**
 * First screen after a sender scans an unused card: the moment a physical
 * gift turns into something personal they're about to write. One job — make
 * the idea click in a few seconds and get one tap on the primary action.
 *
 * The scene is a real photographed card and envelope on a table in window
 * light, with the card's words and the QR Starr seal layered live on top
 * (components/customer/entry-scene.tsx). The page ground takes the table's
 * tone, so the photo dissolves into the page rather than sitting in a box.
 *
 * Mobile: the scene runs edge to edge and the headline rises out of its
 * faded lower edge; then what can go inside, then the action with its three
 * facts. The action sits in the flow — not pinned to the bottom of a tall
 * screen — and only sticks on phones too short to show everything at once.
 * Desktop: the text on the left, the table bleeding off the right edge of
 * the window, its faded edge passing under the text column.
 *
 * Material: the page ground is real paper (a tile from a CC0 paper scan, see
 * public/customer/LICENSES.md); what a greeting can hold is a perforated
 * strip of card stock; the facts are set as quiet editorial metadata; the
 * QR Starr maker's mark is blind-embossed at the foot, where a stationer
 * would put it.
 *
 * Editorial framing (desktop only): an out-of-focus sprig of dried
 * gypsophila at the photograph's edge and a window plant's soft shadow on
 * the upper paper — a photograph applied as light, not a pasted cut-out (see
 * the "Editorial framing" section of globals.css). The centre stays clean.
 *
 * Visual language lives in the "Customer design language" section of
 * globals.css (cx-* classes) and components/customer/, so later customer
 * screens can adopt it deliberately.
 */
export function SenderEntry({ publicToken, priceLabel }: { publicToken: string; priceLabel: string | null }) {
  const t = useTranslations("sender.entry");
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function handleStart() {
    setFailed(false);
    startTransition(async () => {
      // startGreetingAction redirects on success and never returns in that
      // case — reaching here means it returned an error result instead.
      const result = await startGreetingAction(publicToken);
      if (result && !result.ok) setFailed(true);
    });
  }

  const contentTypes = [
    { Icon: TextIcon, label: t("addMessage") },
    { Icon: PhotoIcon, label: t("addPhoto") },
    { Icon: VideoIcon, label: t("addVideo") },
    { Icon: VoiceIcon, label: t("addVoice") },
  ];

  const facts = priceLabel
    ? [
        { value: t("factTimeValue"), label: t("factTimeLabel") },
        { value: priceLabel, label: t("factPriceLabel") },
        { value: t("factPreviewValue"), label: t("factPreviewLabel") },
      ]
    : [];

  return (
    // isolate: a stacking context of its own, so the fixed atmosphere layer
    // sits under this screen's content but above body's paper background.
    // overflow-x-clip: the desktop scene bleeds exactly to the window edge.
    <div className="cx-entry relative isolate overflow-x-clip">
      <div aria-hidden className="cx-atmosphere cx-atmosphere--table pointer-events-none fixed inset-0 -z-10">
        {/* A plant in the window casts its soft shadow across the upper
            paper (desktop only). */}
        <span className="cx-atmosphere__shadow" />
      </div>
      <FlowShell headerEnd={<LocaleSwitcher />} width="wide">
        <div
          className="flex flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,27rem)_minmax(0,1fr)] lg:items-center lg:gap-0"
          data-testid="sender-entry"
        >
          {/* Mobile: edge to edge (-mx), height = whatever the text and the
              action leave (~29rem), capped by WIDTH so the photo shrinks whole
              on short phones; -mb lets the headline rise out of its faded
              edge. Desktop: right column, bled to the window edge (negative
              margin = the gutter outside the 64rem container) and pulled left
              under the text column's edge. */}
          <div className="-mx-4 -mb-10 flex justify-center sm:-mx-6 [@media(max-height:640px)]:-mb-6 lg:order-2 lg:mx-0 lg:mb-0 lg:-ml-[3vw] lg:mr-[calc((min(100vw,64rem)-100vw)/2-1.5rem)] lg:justify-end">
            <EntryScene
              line={t("eyebrow")}
              leaving={pending}
              className="w-full max-w-[max(12rem,calc((100dvh-29rem)*1.143))] lg:w-[min(66vw,calc((100dvh-3.5rem)*1.107))] lg:max-w-none lg:shrink-0"
            />
          </div>

          <div className="relative z-10 mx-auto flex w-full max-w-[34rem] flex-1 flex-col lg:order-1 lg:mx-0 lg:max-w-none lg:flex-none lg:py-12">
            <h1 className="cx-rise cx-display text-display text-balance" style={delay(0)}>
              {t("title")}
            </h1>
            <p className="cx-rise cx-lede mt-3 max-w-[30rem] text-body text-pretty lg:max-w-[25rem] lg:mt-5 lg:text-[1.0625rem]" style={delay(40)}>
              {t("subtitle")}
            </p>

            <div className="cx-rise mt-6 max-w-[26rem] [@media(max-height:640px)]:mt-4 lg:mt-8" style={delay(80)}>
              <p id="entry-keepsake-label" className="cx-caption-rule mb-2.5 leading-snug [@media(max-height:640px)]:sr-only">
                {t("contentTypesLabel")}
              </p>
              {/* Informational, not a picker: plain list items, nothing to
                  select here — every greeting can hold all four. */}
              <div className="cx-keepsake">
                <ul aria-labelledby="entry-keepsake-label" className="cx-keepsake__sheet" data-testid="content-type-row">
                  {contentTypes.map(({ Icon, label }) => (
                    <li key={label} className="cx-keepsake__item">
                      <Icon size={22} weight="light" className="cx-keepsake__icon" aria-hidden />
                      <span className="cx-keepsake__label">{label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div
              className="cx-rise sticky bottom-0 z-10 -mx-4 mt-7 px-4 [@media(max-height:640px)]:mt-4 pt-3 pb-[max(1rem,var(--safe-bottom))] sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:mt-8 lg:max-w-[26rem] lg:p-0"
              style={delay(120)}
            >
              {/* Readability backdrop for when the action is actually stuck
                  over scrolled content — only on phones short enough for that
                  to happen, so tall screens keep the page atmosphere intact. */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 hidden bg-gradient-to-t from-paper from-65% to-paper/0 [@media(max-height:760px)]:block lg:!hidden"
              />
              <div className="relative flex flex-col gap-4">
                {failed && (
                  <Notice tone="danger">
                    <span data-testid="start-error">{t("startError")}</span>
                  </Notice>
                )}
                <PrimaryAction onClick={handleStart} loading={pending} disabled={!priceLabel} data-testid="start-greeting-button">
                  {t("cta")}
                </PrimaryAction>

                {priceLabel ? (
                  <ul className="cx-facts" data-testid="activation-price">
                    {facts.map(({ value, label }) => (
                      <li key={label} className="cx-facts__item">
                        <span className="cx-facts__value">{value}</span>
                        <span className="cx-facts__label">{label}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-center text-caption text-danger" data-testid="price-unavailable">
                    {t("priceUnavailable")}
                  </p>
                )}
              </div>
            </div>

            {/* The maker's mark, blind-embossed where a stationer puts it. */}
            <StarrEmboss className="cx-maker mx-auto mt-6 md:mt-4 lg:mt-12 lg:ml-[calc(13rem-0.875rem)]" />
          </div>
        </div>
      </FlowShell>
    </div>
  );
}
