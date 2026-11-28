import { ArrowRight } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { Check } from "@phosphor-icons/react/dist/ssr/Check";
import { QrCode } from "@phosphor-icons/react/dist/ssr/QrCode";
import { getLanding } from "./copy";
import { Photo } from "./photo";

/**
 * The opening view, composed like a campaign: the gift as it arrives (dark
 * burgundy roses, our card tied to them, the phone showing the greeting it
 * opens), cut out of its photograph so it sits directly on the page. The
 * card and screen in it are part of the picture, not working UI. One primary action; partners get a quiet
 * link. On phones the order is words, action, the note for someone holding
 * a card, then the picture.
 */
export async function Hero() {
  const { text, raw } = await getLanding();

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

        <div className="hm-hstage">
          <div className="hm-hstage__photo">
            <Photo name="hero-bouquet" alt={text("hero.photoAlt")} priority sizes="(min-width: 62rem) min(46rem, 50vw), min(40rem, calc(100vw - 1rem))" />
          </div>
        </div>

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
