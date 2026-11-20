"use client";

import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { RecipientView, SignatureWizard } from "./card-states";
import type { ThemeKey } from "@/lib/themes/registry";
import { SealedEnvelope, SigRoot } from "@/components/signature/chrome";
import { getTemplate } from "@/lib/templates/catalog";
import { roomVars } from "@/lib/templates/room";
import { getThemeWorld, worldVars } from "@/lib/themes/worlds";

/** Lab only: the production recipient screen and the production preview window, either envelope. */
export const THEMES = ["romantic", "birthday", "wedding", "celebration", "elegant", "minimal", "luxury-vintage"] as const;

export function EnvelopeRecipientLab({ theme, env, message }: { theme: string; env: "classic" | "luxe"; message: string }) {
  return (
    <div data-envelope={env === "classic" ? "classic" : undefined} data-testid="envelope-lab">
      <RecipientView greetingId="lab-envelope" themeKey={theme} isOriginalSender={false} content={{ message, photos: [], video: null, audio: null }} />
    </div>
  );
}

function Window({ theme }: { theme: string }) {
  const tt = useTranslations("themes");
  const template = getTemplate(theme)!;
  const style = { ...roomVars(template.spec.room), ...worldVars(getThemeWorld(theme)) } as CSSProperties;
  return (
    <div className="sig-window" style={style} data-room={template.spec.room.dark ? "dark" : "light"} data-composition={template.spec.composition}>
      <span className="sig-window__line">{tt(`${theme}.opening`)}</span>
      <SealedEnvelope small />
    </div>
  );
}

export function EnvelopeWindowsLab() {
  return (
    <SigRoot>
      <main className="sig-page" style={{ paddingBlock: 16 }}>
        {THEMES.map((t) => (
          <div key={t} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
            <div data-envelope="classic">
              <Window theme={t} />
            </div>
            <div>
              <Window theme={t} />
            </div>
          </div>
        ))}
      </main>
    </SigRoot>
  );
}

/** Lab only: the production sender wizard (Step 03 · preview) with a mock draft; no server calls until a button that edits or pays is used. */
export function EnvelopeSenderLab({ theme, env, message }: { theme: string; env: "classic" | "luxe"; message: string }) {
  const initial = {
    greetingId: "lab-envelope",
    themeKey: theme as ThemeKey,
    message,
    photos: [null, null, null],
    video: null,
    audio: null,
    priceLabel: "10 ₾",
    isTestPayments: true,
    merchantSeller: null,
    merchantVatStatus: null,
  };
  return (
    <div data-envelope={env === "classic" ? "classic" : undefined} data-testid="envelope-sender-lab">
      <SignatureWizard initial={initial} />
    </div>
  );
}
