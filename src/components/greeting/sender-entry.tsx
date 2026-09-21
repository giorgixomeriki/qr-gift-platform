"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { startGreetingAction } from "@/lib/greetings/actions";
import { LocaleSwitcher } from "./locale-switcher";

/**
 * A content-type affordance, not decoration — answers "what can I add?" at a
 * glance (Phase 4 §4) without a wall of text. Icons are plain SVG strokes,
 * not emoji, to keep this screen from reading as an AI-generated landing
 * page (Phase 4 §2's explicit warning against "random emojis").
 */
function ContentTypeRow({ labels }: { labels: [string, string, string, string] }) {
  const icons = [
    // message
    <path key="m" d="M4 5h16v11H8l-4 4V5z" />,
    // photo
    <g key="p">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="11" r="2" />
      <path d="M3 17l5-5 4 4 3-3 6 6" />
    </g>,
    // video
    <g key="v">
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="M16 10l5-3v10l-5-3z" />
    </g>,
    // voice
    <g key="a">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </g>,
  ];

  return (
    <div className="grid grid-cols-4 gap-3" data-testid="content-type-row">
      {labels.map((label, i) => (
        <div key={label} className="flex flex-col items-center gap-1.5">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6 opacity-70">
            {icons[i]}
          </svg>
          <span className="text-[11px] text-neutral-500">{label}</span>
        </div>
      ))}
    </div>
  );
}

export function SenderEntry({ publicToken, priceLabel }: { publicToken: string; priceLabel: string | null }) {
  const t = useTranslations("sender.entry");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStart() {
    setPending(true);
    setError(null);
    const result = await startGreetingAction(publicToken);
    // startGreetingAction redirects on success and never returns in that
    // case — reaching here means it returned an error result instead.
    if (result && !result.ok) {
      setPending(false);
      setError(result.error);
    }
  }

  return (
    <main
      className="relative flex min-h-screen flex-col items-center justify-center gap-9 px-6 py-16 text-center text-neutral-100"
      style={{ background: "radial-gradient(circle at 50% 12%, #241a33 0%, #0b0a10 65%)" }}
      data-testid="sender-entry"
    >
      <LocaleSwitcher className="absolute right-5 top-5 text-neutral-500" />

      <div className="flex flex-col items-center gap-5">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" className="h-14 w-14 text-neutral-200" aria-hidden="true">
          <rect x="3" y="9" width="18" height="11" rx="1.5" />
          <path d="M3 9h18M12 9v11" />
          <path d="M7.5 9a2.75 2.75 0 0 1 0-5.5C10 3.5 12 6 12 9c0-3 2-5.5 4.5-5.5a2.75 2.75 0 0 1 0 5.5" />
        </svg>
        <div className="flex flex-col items-center gap-2">
          <h1 className="max-w-xs text-[1.75rem] font-semibold leading-tight">{t("title")}</h1>
          <p className="max-w-[19rem] text-sm leading-relaxed text-neutral-400">{t("subtitle")}</p>
        </div>
        <ContentTypeRow labels={[t("addMessage"), t("addPhoto"), t("addVideo"), t("addVoice")]} />
      </div>

      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={handleStart}
          disabled={pending || !priceLabel}
          className="min-w-[15rem] rounded-full bg-white px-8 py-4 text-base font-semibold text-black transition active:scale-[0.98] disabled:opacity-50"
          data-testid="start-greeting-button"
        >
          {pending ? "…" : t("cta")}
        </button>

        {priceLabel ? (
          <p className="text-sm text-neutral-400" data-testid="activation-price">
            {t("priceLabel")}: <span className="font-medium text-neutral-200">{priceLabel}</span>
          </p>
        ) : (
          <p className="max-w-xs text-sm text-red-300" data-testid="price-unavailable">
            {t("priceUnavailable")}
          </p>
        )}

        <p className="max-w-[17rem] text-xs leading-relaxed text-neutral-500">
          {t("timeEstimate")} · {t("afterActivation")}
        </p>

        {error && (
          <p className="text-sm text-red-300" data-testid="start-error">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
