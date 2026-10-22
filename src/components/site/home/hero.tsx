import { ArrowRight } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { Check } from "@phosphor-icons/react/dist/ssr/Check";
import { QrCode } from "@phosphor-icons/react/dist/ssr/QrCode";
import { Microphone } from "@phosphor-icons/react/dist/ssr/Microphone";
import { getHomeQrSvg, getLanding } from "./copy";
import { LetterScreen, PhoneShell, QrCard } from "./objects";
import { Photo } from "./photo";
import { HeroStage } from "./motion";

/**
 * The opening view, composed like a campaign: a photograph of a real gift
 * (tulips in kraft paper), our QR card tucked beside it, and the phone that
 * card opens, breaking out of the photograph's frame. One primary action;
 * partners get a quiet link. On phones the order is words, action, the note
 * for someone holding a card, then the picture.
 */
export async function Hero() {
  const { text, raw } = await getLanding();
  const svg = await getHomeQrSvg();
  const sample = { to: text("hero.sampleTo"), text: text("hero.sampleText"), sign: text("hero.sampleSign"), voice: text("hero.sampleVoice"), tag: text("hero.sampleTag") };

  return (
    <section className="hm-hero" aria-labelledby="hm-hero-title" data-testid="home-hero">
      <div className="hm-wrap hm-hero__grid">
        <div className="hm-hero__copy">
          <p className="hm-kicker">{text("hero.eyebrow")}</p>
          <h1 id="hm-hero-title" className="hm-display">
            {text("hero.titleA")} <em>{text("hero.titleB")}</em>
          </h1>
          <p className="hm-lead">{text("hero.lead")}</p>
          <div className="hm-hero__actions">
            <a href="#how" className="hm-btn hm-btn--primary">
              {text("hero.primary")}
              <span className="hm-btn__disc" aria-hidden>
                <ArrowRight size={16} weight="bold" />
              </span>
            </a>
            <a href="#partners" className="hm-link">
              {text("hero.secondaryLink")}
              <ArrowRight size={16} aria-hidden />
            </a>
          </div>
        </div>

        <HeroStage
          label={`${text("hero.photoAlt")}. ${text("hero.plateAlt")}`}
          plate={<Photo name="redoute-josephine" alt="" sizes="(min-width: 62rem) 18vw, 40vw" />}
          photo={<Photo name="hero-tulips" alt="" priority sizes="(min-width: 62rem) 34vw, 78vw" position="40% 40%" />}
          card={<QrCard svg={svg} line={text("hero.cardLine")} hint={text("hero.cardHint")} />}
          phone={
            <PhoneShell>
              <LetterScreen copy={sample} />
            </PhoneShell>
          }
          badges={
            <>
              <span className="hm-gilt hm-gilt--photo" aria-hidden />
              <span className="hm-badge hm-badge--scan">
                <QrCode size={16} weight="regular" aria-hidden />
                {text("hero.badgeScan")}
              </span>
              <span className="hm-badge hm-badge--voice">
                <Microphone size={16} weight="fill" aria-hidden />
                {text("hero.badgeVoice")} · 0:24
              </span>
            </>
          }
        />

        <ul className="hm-hero__assure">
          {raw<string[]>("hero.assurances").map((a) => (
            <li key={a}>
              <Check size={16} weight="bold" aria-hidden />
              {a}
            </li>
          ))}
        </ul>
        <p className="hm-hint" data-testid="home-recipient-hint">
          <QrCode size={20} weight="light" aria-hidden />
          <span>{text("hero.recipientHint")}</span>
        </p>
      </div>
    </section>
  );
}
