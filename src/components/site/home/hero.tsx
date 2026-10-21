import { ArrowRight } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { Check } from "@phosphor-icons/react/dist/ssr/Check";
import { getHomeQrSvg, getLanding } from "./copy";
import { LetterScreen, Phone, QrCard } from "./objects";

/** The opening view: the promise in one line, and the card beside the phone it opened. */
export async function Hero() {
  const { text, raw } = await getLanding();
  const svg = await getHomeQrSvg();
  const sample = { to: text("hero.sampleTo"), text: text("hero.sampleText"), sign: text("hero.sampleSign"), voice: text("hero.sampleVoice"), tag: text("hero.sampleTag") };

  return (
    <section className="hm-hero" aria-labelledby="hm-hero-title" data-testid="home-hero">
      <div className="hm-hero__light" aria-hidden />
      <div className="hm-wrap hm-hero__grid">
        <div className="hm-hero__copy">
          <p className="hm-kicker">{text("hero.eyebrow")}</p>
          <h1 id="hm-hero-title" className="hm-display">
            {text("hero.titleA")} <em>{text("hero.titleB")}</em>
          </h1>
          <p className="hm-lead">{text("hero.lead")}</p>
          <div className="hm-actions hm-actions--stack mt-2">
            <a href="#how" className="hm-btn hm-btn--primary">
              {text("hero.primary")}
              <span className="hm-btn__disc" aria-hidden>
                <ArrowRight size={16} weight="bold" />
              </span>
            </a>
            <a href="#partners" className="hm-btn hm-btn--quiet">
              {text("hero.secondary")}
            </a>
          </div>
          <ul className="hm-hero__assure">
            {raw<string[]>("hero.assurances").map((a) => (
              <li key={a}>
                <Check size={16} weight="bold" aria-hidden />
                {a}
              </li>
            ))}
          </ul>
        </div>

        <div className="hm-stage" role="img" aria-label={text("hero.visualLabel")}>
          <span className="hm-stage__shadow" />
          <QrCard svg={svg} line={text("hero.cardLine")} hint={text("hero.cardHint")} className="hm-stage__card" />
          <Phone className="hm-stage__phone">
            <LetterScreen copy={sample} />
          </Phone>
        </div>
      </div>
    </section>
  );
}
