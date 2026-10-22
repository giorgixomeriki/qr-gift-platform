import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { Check } from "@phosphor-icons/react/dist/ssr/Check";
import { HandSwipeRight } from "@phosphor-icons/react/dist/ssr/HandSwipeRight";
import { Marquee } from "@/components/vendor/magicui/marquee";
import { CardsCarousel } from "@/components/vendor/aceternity/cards-carousel";
import { FocusCards } from "@/components/vendor/aceternity/focus-cards";
import { getHomeQrSvg, getLanding } from "./copy";
import { CardComposite, KeepScreen, LetterScreen, OpenScreen, QrCard, ScanScreen } from "./objects";
import { OccasionPostcard, PaperToScreen, PostcardFan } from "./vintage";
import { Photo } from "./photo";
import type { PhotoName } from "./photos";
import { DemoLetterText, PhotoStack, TiltCard } from "./motion";
import { DesignShowcase } from "./design-showcase";
import { VoiceMessage } from "./voice-message";
import { HeroVideoDialog } from "@/components/vendor/magicui/hero-video-dialog";
import VOICE_PEAKS from "../../../../public/site/media/voice-sonnet43.peaks.json";
import { ScanDemo } from "./scan-demo";

/*
 * The home page's sections, top to bottom. Server components read their own
 * copy; interaction comes from the vendored components (components/vendor)
 * and the motion layer (motion.tsx). Photographs are licensed stock that
 * illustrate gifting; none is presented as a QR Starr customer or partner.
 */

type Item = { title: string; text: string };

function Head({ id, eyebrow, title, lead, center = false }: { id: string; eyebrow: string; title: string; lead?: React.ReactNode; center?: boolean }) {
  return (
    <header className={`hm-head ${center ? "hm-head--center" : ""}`} data-reveal>
      <p className="hm-kicker">{eyebrow}</p>
      <h2 id={id} className="hm-title">
        {title}
      </h2>
      {lead && <p className="hm-lead">{lead}</p>}
    </header>
  );
}

function Arrow() {
  return (
    <span className="hm-btn__disc" aria-hidden>
      <ArrowRight size={16} weight="bold" />
    </span>
  );
}

/* ------------------------------------------------------------ moments */
const MOMENTS: PhotoName[] = ["gift-wrapping", "bouquet-peonies", "gift-opening", "wax-seal-ribbon", "roses-envelope", "bouquet-garden"];

/** A slow ribbon of gifting moments (Magic UI Marquee): the world the card travels in. */
export async function Moments() {
  const { text, raw } = await getLanding();
  const alts = raw<string[]>("moments.alts");
  return (
    <section className="hm-moments" aria-label={text("moments.label")}>
      <Marquee pauseOnHover className="[--hm-marquee-duration:70s]">
        {MOMENTS.map((name, i) => (
          <figure key={name} className={`hm-moment hm-moment--${i % 3}`}>
            <Photo name={name} alt={alts[i] ?? ""} sizes="(min-width: 48rem) 300px, 220px" />
          </figure>
        ))}
      </Marquee>
    </section>
  );
}

/* -------------------------------------------------------------- steps */

export async function Steps() {
  const { text, raw } = await getLanding();
  const svg = await getHomeQrSvg();
  const items = raw<Item[]>("steps.items");
  const alts = raw<string[]>("steps.alts");
  const visual = (i: number) =>
    i === 0 ? (
      <Photo name="florist-peonies" alt={alts[0] ?? ""} sizes="(min-width: 48rem) 30vw, 80vw" position="50% 40%" />
    ) : i === 1 ? (
      <CardComposite svg={svg} line={text("hero.cardLine")} alt={alts[1] ?? ""} sizes="(min-width: 48rem) 30vw, 80vw" />
    ) : (
      <Photo name="reader-tulips" alt={alts[2] ?? ""} sizes="(min-width: 48rem) 30vw, 80vw" position="38% 50%" />
    );
  return (
    <section className="hm-section" id="how" aria-labelledby="hm-steps-title">
      <div className="hm-wrap">
        <Head id="hm-steps-title" eyebrow={text("steps.eyebrow")} title={text("steps.title")} />
        <ol className="hm-steps">
          {items.map((s, i) => {
            return (
              <li key={i} className="hm-step">
                <div className="hm-step__frame">
                  {visual(i)}
                  <span className="hm-step__num hm-numeral" aria-hidden>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                </div>
                <div className="hm-step__body">
                  <h3 className="hm-h3">{s.title}</h3>
                  <p className="hm-body">{s.text}</p>
                </div>
              </li>
            );
          })}
        </ol>
        <p className="mt-10">
          <Link href="/how-it-works" className="hm-link">
            {text("steps.more")}
            <ArrowRight size={16} aria-hidden />
          </Link>
        </p>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------- transform */
/** From paper to screen: the physical card and the greeting it opens, compared. */
export async function Transform() {
  const { text, ctx } = await getLanding();
  const svg = await getHomeQrSvg();
  return (
    <section className="hm-section hm-transform" id="paper-to-screen" aria-labelledby="hm-transform-title">
      <div className="hm-wrap">
        <span className="hm-divider" aria-hidden />
        <Head id="hm-transform-title" eyebrow={text("transform.eyebrow")} title={text("transform.title")} lead={text("transform.lead")} center />
        <PaperToScreen
          labels={{ paper: text("transform.paper"), screen: text("transform.screen"), slider: text("transform.slider"), value: text("transform.value") }}
          paper={
            <div className="hm-compare__paper" role="img" aria-label={text("transform.paperAlt")}>
              <Photo name="sealed-letter" alt="" sizes="(min-width: 64rem) 60rem, 100vw" position="50% 40%" />
              <QrCard svg={svg} line={text("hero.cardLine")} hint={text("hero.cardHint")} className="hm-compare__card" />
            </div>
          }
          screen={
            <div className="hm-compare__screen">
              <Photo name={`design-romantic-${ctx.locale}` as PhotoName} alt="" sizes="(min-width: 64rem) 22rem, 46vw" className="hm-compare__design" />
            </div>
          }
        />
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- demo */
export async function Demo() {
  const { text, raw, rich } = await getLanding();
  const svg = await getHomeQrSvg();
  const sample = { to: text("hero.sampleTo"), text: text("hero.sampleText"), sign: text("hero.sampleSign"), voice: text("hero.sampleVoice"), tag: text("hero.sampleTag") };
  const beats = raw<{ label: string; title: string }[]>("demo.beats").map((b, i) => ({ ...b, text: rich(`demo.beats.${i}.text`) }));
  const letter = `${sample.text} ${text("experiences.letterSample")}`;

  return (
    <section className="hm-section hm-demo-section" id="after-scan" aria-labelledby="hm-demo-title">
      <div className="hm-wrap">
        <Head id="hm-demo-title" eyebrow={text("demo.eyebrow")} title={text("demo.title")} lead={text("demo.lead")} />
        <div className="hm-demo-stage">
          <div className="hm-demo-stage__photo">
            <Photo name="recipient-admiring" alt={text("demo.photoAlt")} sizes="(min-width: 56rem) 26vw, 0px" position="50% 55%" />
          </div>
          <ScanDemo
            beats={beats}
            labels={{ tabs: text("demo.tabsLabel") }}
            screens={[
              <ScanScreen key="scan" svg={svg} cardLine={text("hero.cardLine")} pill="qrapp.ge" />,
              <OpenScreen key="open" to={sample.to} cta={text("demo.screenOpen")} />,
              <LetterScreen key="read" copy={{ ...sample, text: letter }} withKeepsakes={false} letter={<DemoLetterText text={letter} beat={2} className="hm-letter__text" />} />,
              <KeepScreen key="keep" copy={sample} />,
            ]}
          />
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------- experiences */
const STACK: PhotoName[] = ["keepsake-hug", "bouquet-garden", "keepsake-picnic", "occasion-love"];
const DESIGN_ORDER = ["romantic", "birthday", "wedding", "celebration", "elegant", "minimal"] as const;

/**
 * Inside a greeting: the six real designs as the centrepiece, then an
 * editorial spread of what a greeting holds: the letter, photo prints, a
 * real video and a real voice note. No identical cards.
 */
export async function Experiences() {
  const { text, raw, rich, ctx } = await getLanding();
  const tApp = await getTranslations("themes");
  const stackAlts = raw<string[]>("experiences.stackAlts");
  const loc = ctx.locale;
  const designs = DESIGN_ORDER.map((key) => {
    const name = tApp(`${key}.name`);
    return {
      key,
      name,
      tagline: tApp(`${key}.tagline`),
      opening: tApp(`${key}.opening`),
      image: <Photo name={`design-${key}-${loc}` as PhotoName} alt={text("experiences.designAlt").replace("{name}", name)} sizes="(min-width: 64rem) 30rem, 82vw" />,
    };
  });
  const voice = VOICE_PEAKS;

  return (
    <section className="hm-section hm-inside" id="greetings" aria-labelledby="hm-exp-title">
      <div className="hm-wrap">
        <Head id="hm-exp-title" eyebrow={text("experiences.eyebrow")} title={text("experiences.title")} lead={text("experiences.lead")} />
        <DesignShowcase designs={designs} label={text("experiences.designsLabel")} counter={text("experiences.designsCounter")} />

        <div className="hm-spread">
          <article className="hm-spread__letter hm-paper">
            <p className="hm-spread__label">{text("experiences.letterLabel")}</p>
            <p className="hm-spread__words">
              {text("hero.sampleText")} {text("experiences.letterSample")}
            </p>
            <p className="hm-spread__sign">{tApp("romantic.ending")}</p>
            <p className="hm-spread__meta">{rich("experiences.letterLimit")}</p>
          </article>

          <div className="hm-spread__prints">
            <PhotoStack
              label={text("experiences.stackLabel")}
              cards={STACK.map((name, i) => (
                <Photo key={name} name={name} alt={stackAlts[i] ?? ""} sizes="260px" />
              ))}
            />
            <p className="hm-spread__meta hm-spread__meta--center">
              <HandSwipeRight size={16} weight="regular" aria-hidden /> {rich("experiences.photosLabel")} · {text("experiences.stackHint")}
            </p>
          </div>

          <div className="hm-spread__video">
            <HeroVideoDialog
              title={text("experiences.videoTitle")}
              duration="0:09"
              videoSrc="/site/media/video-bouquet-720.mp4"
              posterSrc="/site/media/video-bouquet-poster-1280.webp"
              labels={{ play: text("experiences.videoPlay"), close: text("experiences.videoClose") }}
              poster={
                <picture className="hm-photo">
                  <source type="image/avif" srcSet="/site/media/video-bouquet-poster-640.avif 640w, /site/media/video-bouquet-poster-1280.avif 1280w" sizes="(min-width: 64rem) 40rem, 92vw" />
                  <img src="/site/media/video-bouquet-poster-1280.webp" srcSet="/site/media/video-bouquet-poster-640.webp 640w, /site/media/video-bouquet-poster-1280.webp 1280w" sizes="(min-width: 64rem) 40rem, 92vw" alt={text("experiences.videoAlt")} width={1280} height={720} loading="lazy" decoding="async" />
                </picture>
              }
            />
            <p className="hm-spread__meta">{rich("experiences.videoLimit")}</p>
          </div>

          <div className="hm-spread__voice">
            <VoiceMessage
              src="/site/media/voice-sonnet43.m4a"
              peaks={voice.peaks}
              duration={voice.duration}
              title={text("experiences.voiceTitle")}
              credit={text("experiences.voiceCredit")}
              labels={{ play: text("experiences.voicePlay"), pause: text("experiences.voicePause"), seek: text("experiences.voiceSeek") }}
            />
            <p className="hm-spread__meta">{rich("experiences.voiceLimit")}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------- occasions */
const OCCASIONS: { theme: string; photo: PhotoName; plate: PhotoName; position?: string }[] = [
  { theme: "birthday", photo: "occasion-birthday", plate: "redoute-pompon", position: "50% 45%" },
  { theme: "romantic", photo: "occasion-love", plate: "redoute-josephine", position: "50% 40%" },
  { theme: "elegant", photo: "roses-hands", plate: "redoute-gallica", position: "50% 55%" },
  { theme: "wedding", photo: "occasion-wedding", plate: "redoute-moss", position: "45% 50%" },
  { theme: "celebration", photo: "occasion-celebration", plate: "ruotte-bouquet", position: "60% 50%" },
  { theme: "minimal", photo: "gift-parcel", plate: "redoute-cabbage", position: "50% 50%" },
];

export async function Occasions() {
  const { text, raw, ctx } = await getLanding();
  const tApp = await getTranslations("themes");
  const items = raw<Item[]>("occasions.items");
  const alts = raw<string[]>("occasions.alts");
  return (
    <section className="hm-section" id="occasions" aria-labelledby="hm-occ-title">
      <div className="hm-wrap">
        <Head id="hm-occ-title" eyebrow={text("occasions.eyebrow")} title={text("occasions.title")} lead={text("occasions.lead")} />
      </div>
      <div className="hm-occ-rail">
        <CardsCarousel
          label={text("occasions.listLabel")}
          labels={{ previous: text("occasions.previous"), next: text("occasions.next") }}
          items={items.map((o, i) => {
            const occ = OCCASIONS[i] ?? OCCASIONS[5]!;
            const design = tApp(`${occ.theme}.name`);
            return (
              <OccasionPostcard
                key={i}
                front={<Photo name={occ.photo} alt={alts[i] ?? ""} sizes="(min-width: 48rem) 340px, 76vw" position={occ.position} />}
                plate={<Photo name={occ.plate} alt={text("occasions.plateAlt")} sizes="(min-width: 48rem) 320px, 60vw" />}
                swatch={<Photo name={`design-${occ.theme}-${ctx.locale}` as PhotoName} alt="" sizes="72px" className="hm-occ__swatch" />}
                label={`${text("occasions.designLabel")}: ${design}`}
                title={o.title}
                text={o.text}
                designLabel={text("occasions.from").replace("{design}", design)}
                opening={tApp(`${occ.theme}.opening`)}
                sample={tApp(`${occ.theme}.sample`)}
                labels={{ open: text("occasions.open").replace("{title}", o.title), close: text("occasions.close"), postcard: text("occasions.postcard") }}
              />
            );
          })}
        />
      </div>
    </section>
  );
}

/* ----------------------------------------------------------- partners */
const PARTNER_PHOTOS: { name: PhotoName; position: string }[] = [
  { name: "florist-roses", position: "50% 45%" },
  { name: "bouquet-peonies", position: "50% 50%" },
  { name: "flower-stall-dusk", position: "45% 60%" },
];

export async function Partners() {
  const { text, raw } = await getLanding();
  const items = raw<Item[]>("partners.items");
  const cards = raw<{ title: string; caption: string }[]>("partners.cards");
  const alts = raw<string[]>("partners.photoAlts");
  return (
    <section className="hm-section hm-dark" id="partners" aria-labelledby="hm-partners-title" data-testid="home-partners">
      <div className="hm-wrap">
        <div className="hm-partners">
          <div className="grid justify-items-start gap-6">
            <p className="hm-kicker">{text("partners.eyebrow")}</p>
            <h2 id="hm-partners-title" className="hm-title">
              {text("partners.title")}
            </h2>
            <p className="hm-lead">{text("partners.lead")}</p>
            <div className="hm-actions hm-actions--stack mt-2">
              <Link href="/contact" className="hm-btn hm-btn--cream" data-testid="home-partner-contact">
                {text("partners.primary")}
                <Arrow />
              </Link>
              <Link href="/partner/login" className="hm-btn hm-btn--ring" data-testid="home-partner-login">
                {text("partners.secondary")}
              </Link>
            </div>
            <p className="hm-caption">{text("partners.terms")}</p>
          </div>
          <FocusCards
            className="hm-partners__gallery"
            cards={cards.map((c, i) => ({
              title: c.title,
              caption: c.caption,
              media: <Photo name={PARTNER_PHOTOS[i]!.name} alt={alts[i] ?? ""} sizes="(min-width: 60rem) 18vw, 80vw" position={PARTNER_PHOTOS[i]!.position} />,
            }))}
          />
        </div>
        <ul className="hm-benefits">
          {items.map((b, i) => {
            return (
              <li key={i} className="hm-benefit">
                <span className="hm-benefit__n hm-numeral" aria-hidden>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="hm-h3">{b.title}</h3>
                <p className="hm-body">{b.text}</p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ pricing */
export async function Pricing() {
  const { text, raw, rich } = await getLanding();
  const svg = await getHomeQrSvg();
  const included = raw<string[]>("pricing.included");
  return (
    <section className="hm-section" id="pricing" aria-labelledby="hm-pricing-title">
      <div className="hm-wrap hm-pricing">
        <div className="grid justify-items-start gap-5">
          <p className="hm-kicker">{text("pricing.eyebrow")}</p>
          <h2 id="hm-pricing-title" className="hm-title">
            {text("pricing.title")}
          </h2>
          <p className="hm-lead">{text("pricing.lead")}</p>
          <Link href="/pricing" className="hm-link">
            {text("pricing.more")}
            <ArrowRight size={16} aria-hidden />
          </Link>
        </div>
        <div className="hm-pricing__visual">
          <div className="hm-pricing__mat" aria-hidden>
            <Photo name="lace-valentine" alt="" sizes="(min-width: 56rem) 24vw, 60vw" />
          </div>
          <CardComposite svg={svg} line={text("hero.cardLine")} alt={text("pricing.compositeAlt")} sizes="(min-width: 56rem) 26vw, 70vw" className="hm-pricing__photo" />
          <TiltCard className="hm-pricing__slip">
            <div className="hm-slip hm-paper" data-testid="home-price">
              <p className="hm-kicker">{text("pricing.label")}</p>
              <p className="hm-slip__price">{rich("pricing.price")}</p>
              <p className="hm-body mt-2">{text("pricing.unit")}</p>
              <ul className="hm-slip__rows">
                {included.map((_, i) => (
                  <li key={i}>
                    <Check size={16} weight="bold" aria-hidden />
                    <span>{rich(`pricing.included.${i}`)}</span>
                  </li>
                ))}
              </ul>
              <p className="hm-caption mt-5">{text("pricing.note")}</p>
            </div>
          </TiltCard>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- trust */

export async function Trust() {
  const { text, raw, rich } = await getLanding();
  const items = raw<Item[]>("trust.items");
  const faq = raw<{ q: string; a: string }[]>("trust.faq");
  return (
    <section className="hm-section" id="faq" aria-labelledby="hm-trust-title" style={{ background: "var(--hm-paper-2)" }}>
      <div className="hm-wrap hm-trustfaq">
        <div className="hm-trustfaq__side">
          <Head id="hm-trust-title" eyebrow={text("trust.eyebrow")} title={text("trust.title")} />
          <ul className="hm-trust">
            {items.map((it, i) => {
              return (
                <li key={i} className="hm-trust__item">
                  <span className="hm-trust__n hm-numeral" aria-hidden>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3 className="hm-h3">{it.title}</h3>
                    <p className="hm-body mt-1">{it.text}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="hm-faq">
          <span className="hm-gilt hm-gilt--tr" aria-hidden />
          <h2 className="hm-faq__title">{text("trust.faqTitle")}</h2>
          <div className="hm-faq__list">
            {faq.map((f, i) => (
              <details key={i} className="hm-faq__item" name="hm-faq">
                <summary>
                  {f.q}
                  <span className="hm-faq__toggle" aria-hidden />
                </summary>
                <p className="hm-body">{rich(`trust.faq.${i}.a`)}</p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
/* ------------------------------------------------------------- finale */
const POSTCARDS: PhotoName[] = ["redoute-pompon", "roses-envelope", "redoute-gallica", "wax-seal-ribbon", "redoute-cabbage"];

export async function Finale() {
  const { text, raw } = await getLanding();
  const alts = raw<string[]>("finale.postcardAlts");
  return (
    <section className="hm-finale" aria-labelledby="hm-finale-title">
      <div className="hm-finale__photo" aria-hidden>
        <Photo name="roses-vintage" alt="" sizes="100vw" position="50% 50%" />
      </div>
      <div className="hm-wrap hm-finale__inner">
        <PostcardFan label={text("finale.postcardsLabel")} cards={POSTCARDS.map((name, i) => ({ alt: alts[i] ?? "", node: <Photo name={name} alt="" sizes="180px" /> }))} />
        <h2 id="hm-finale-title" className="hm-title hm-finale__title">
          {text("finale.title")}
        </h2>
        <p className="hm-lead mx-auto mt-5">{text("finale.body")}</p>
        <div className="hm-actions hm-actions--stack">
          <Link href="/how-it-works" className="hm-btn hm-btn--cream">
            {text("finale.primary")}
            <Arrow />
          </Link>
          <Link href="/contact" className="hm-btn hm-btn--ring">
            {text("finale.secondary")}
          </Link>
        </div>
      </div>
    </section>
  );
}
