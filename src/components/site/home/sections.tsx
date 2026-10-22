import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { Check } from "@phosphor-icons/react/dist/ssr/Check";
import { Storefront } from "@phosphor-icons/react/dist/ssr/Storefront";
import { DeviceMobileCamera } from "@phosphor-icons/react/dist/ssr/DeviceMobileCamera";
import { EnvelopeOpen } from "@phosphor-icons/react/dist/ssr/EnvelopeOpen";
import { PenNib } from "@phosphor-icons/react/dist/ssr/PenNib";
import { Image as ImageIcon } from "@phosphor-icons/react/dist/ssr/Image";
import { VideoCamera } from "@phosphor-icons/react/dist/ssr/VideoCamera";
import { Microphone } from "@phosphor-icons/react/dist/ssr/Microphone";
import { Swatches } from "@phosphor-icons/react/dist/ssr/Swatches";
import { Play } from "@phosphor-icons/react/dist/ssr/Play";
import { Gift } from "@phosphor-icons/react/dist/ssr/Gift";
import { Printer } from "@phosphor-icons/react/dist/ssr/Printer";
import { ChartLineUp } from "@phosphor-icons/react/dist/ssr/ChartLineUp";
import { EyeSlash } from "@phosphor-icons/react/dist/ssr/EyeSlash";
import { Eye } from "@phosphor-icons/react/dist/ssr/Eye";
import { LockSimple } from "@phosphor-icons/react/dist/ssr/LockSimple";
import { DeviceMobile } from "@phosphor-icons/react/dist/ssr/DeviceMobile";
import { ArrowCounterClockwise } from "@phosphor-icons/react/dist/ssr/ArrowCounterClockwise";
import { HandSwipeRight } from "@phosphor-icons/react/dist/ssr/HandSwipeRight";
import { ThemeSwatch } from "@/components/greeting/theme-swatch";
import { WaxSeal } from "@/components/customer/wax-seal";
import { SELECTABLE_THEMES } from "@/lib/themes/registry";
import { Marquee } from "@/components/vendor/magicui/marquee";
import { BlurFade } from "@/components/vendor/magicui/blur-fade";
import { CardsCarousel } from "@/components/vendor/aceternity/cards-carousel";
import { FocusCards } from "@/components/vendor/aceternity/focus-cards";
import { getHomeQrSvg, getLanding } from "./copy";
import { CardComposite, KeepScreen, LetterScreen, OpenScreen, ScanScreen, Wave } from "./objects";
import { Photo } from "./photo";
import type { PhotoName } from "./photos";
import { DemoLetterText, PhotoStack, RevealText, TiltCard } from "./motion";
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
const MOMENTS: PhotoName[] = ["gift-hands-cafe", "bouquet-garden", "gift-box-held", "occasion-love", "recipient-street", "gift-parcel"];

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
const STEP_ICONS = [Storefront, DeviceMobileCamera, EnvelopeOpen];

export async function Steps() {
  const { text, raw } = await getLanding();
  const svg = await getHomeQrSvg();
  const items = raw<Item[]>("steps.items");
  const alts = raw<string[]>("steps.alts");
  const visual = (i: number) =>
    i === 0 ? (
      <Photo name="florist-arranging" alt={alts[0] ?? ""} sizes="(min-width: 48rem) 30vw, 92vw" position="50% 35%" />
    ) : i === 1 ? (
      <CardComposite svg={svg} line={text("hero.cardLine")} alt={alts[1] ?? ""} sizes="(min-width: 48rem) 30vw, 92vw" />
    ) : (
      <Photo name="recipient-street" alt={alts[2] ?? ""} sizes="(min-width: 48rem) 30vw, 92vw" position="52% 40%" />
    );
  return (
    <section className="hm-section" id="how" aria-labelledby="hm-steps-title">
      <div className="hm-wrap">
        <Head id="hm-steps-title" eyebrow={text("steps.eyebrow")} title={text("steps.title")} />
        <ol className="hm-steps">
          {items.map((s, i) => {
            const Icon = STEP_ICONS[i] ?? Gift;
            return (
              <li key={i} className="hm-step">
                <BlurFade inView delay={i * 0.12} duration={0.7} className="hm-step__frame">
                  {visual(i)}
                  <span className="hm-step__num hm-numeral" aria-hidden>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                </BlurFade>
                <div className="hm-step__body">
                  <span className="hm-step__icon" aria-hidden>
                    <Icon size={20} weight="light" />
                  </span>
                  <h3 className="hm-h3">{s.title}</h3>
                  <p className="hm-body">{s.text}</p>
                </div>
              </li>
            );
          })}
        </ol>
        <p className="mt-10" data-reveal>
          <Link href="/how-it-works" className="hm-link">
            {text("steps.more")}
            <ArrowRight size={16} aria-hidden />
          </Link>
        </p>
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
        <div className="hm-demo-stage" data-reveal>
          <div className="hm-demo-stage__photo" aria-hidden>
            <Photo name="recipient-smile" alt="" sizes="(min-width: 56rem) 26vw, 0px" position="30% 35%" />
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
const STACK: PhotoName[] = ["keepsake-picnic", "keepsake-hug", "bouquet-garden", "occasion-love"];

export async function Experiences() {
  const { text, raw, rich } = await getLanding();
  const tApp = await getTranslations("themes");
  const stackAlts = raw<string[]>("experiences.stackAlts");
  const tile = (key: string, Icon: typeof PenNib) => (
    <>
      <span className="hm-tile__icon">
        <Icon size={20} weight="light" aria-hidden />
        <h3 className="hm-h3 text-[var(--hm-ink)]">{rich(`experiences.${key}.title`)}</h3>
      </span>
      <p className="hm-body">{rich(`experiences.${key}.text`)}</p>
    </>
  );

  return (
    <section className="hm-section" id="greetings" aria-labelledby="hm-exp-title" style={{ background: "var(--hm-paper-2)" }}>
      <div className="hm-wrap">
        <Head id="hm-exp-title" eyebrow={text("experiences.eyebrow")} title={text("experiences.title")} lead={text("experiences.lead")} />
        <ul className="hm-bento">
          <li className="hm-tile hm-tile--photos hm-paper" data-reveal>
            <div className="hm-tile__art hm-tile__art--stack">
              <PhotoStack
                label={text("experiences.stackLabel")}
                cards={STACK.map((name, i) => (
                  <Photo key={name} name={name} alt={stackAlts[i] ?? ""} sizes="260px" />
                ))}
              />
              <span className="hm-tile__hint" aria-hidden>
                <HandSwipeRight size={16} weight="regular" />
                {text("experiences.stackHint")}
              </span>
            </div>
            {tile("photos", ImageIcon)}
          </li>
          <li className="hm-tile hm-tile--letter hm-paper" data-reveal style={{ ["--d" as string]: 1 }}>
            <div className="hm-tile__art" aria-hidden>
              <p className="hm-tile__letter">
                {text("experiences.letterSample")}
                <span className="hm-tile__caret" />
              </p>
            </div>
            {tile("message", PenNib)}
          </li>
          <li className="hm-tile hm-tile--video hm-paper" data-reveal>
            <div className="hm-tile__art hm-tile__art--video">
              <Photo name="gift-hands-cafe" alt={text("experiences.videoAlt")} sizes="(min-width: 64rem) 30vw, 92vw" />
              <span className="hm-tile__play" aria-hidden>
                <Play size={20} weight="fill" />
              </span>
            </div>
            {tile("video", VideoCamera)}
          </li>
          <li className="hm-tile hm-tile--voice hm-paper" data-reveal style={{ ["--d" as string]: 1 }}>
            <div className="hm-tile__art" aria-hidden>
              <span className="hm-tile__rec">0:24</span>
              <Wave className="hm-tile__wave" />
            </div>
            {tile("voice", Microphone)}
          </li>
          <li className="hm-tile hm-tile--designs hm-paper" data-reveal>
            <div className="hm-tile__art" aria-hidden>
              {SELECTABLE_THEMES.map((th) => (
                <span key={th.key} className="hm-swatch">
                  <ThemeSwatch themeKey={th.key} className="hm-swatch__art" />
                  <span className="hm-swatch__name">{tApp(`${th.key}.name`)}</span>
                </span>
              ))}
            </div>
            {tile("designs", Swatches)}
          </li>
        </ul>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------- occasions */
const OCCASIONS: { theme: string; photo: PhotoName; position?: string }[] = [
  { theme: "birthday", photo: "occasion-birthday", position: "50% 45%" },
  { theme: "romantic", photo: "occasion-love", position: "50% 40%" },
  { theme: "elegant", photo: "occasion-anniversary", position: "40% 50%" },
  { theme: "wedding", photo: "occasion-wedding", position: "45% 50%" },
  { theme: "celebration", photo: "occasion-celebration", position: "60% 50%" },
  { theme: "minimal", photo: "occasion-justbecause", position: "50% 50%" },
];

export async function Occasions() {
  const { text, raw } = await getLanding();
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
            return (
              <figure className="hm-occ" key={i}>
                <Photo name={occ.photo} alt={alts[i] ?? ""} sizes="(min-width: 48rem) 340px, 76vw" position={occ.position} />
                <span className="hm-occ__design" aria-hidden>
                  <ThemeSwatch themeKey={occ.theme} className="hm-occ__swatch" />
                </span>
                <figcaption className="hm-occ__body">
                  <span className="hm-occ__label">
                    {text("occasions.designLabel")}: {tApp(`${occ.theme}.name`)}
                  </span>
                  <h3 className="hm-occ__title">{o.title}</h3>
                  <p className="hm-occ__text">{o.text}</p>
                </figcaption>
              </figure>
            );
          })}
        />
      </div>
    </section>
  );
}

/* ----------------------------------------------------------- partners */
const BENEFIT_ICONS = [Gift, Printer, ChartLineUp, EyeSlash];
const PARTNER_PHOTOS: { name: PhotoName; position: string }[] = [
  { name: "florist-arranging", position: "50% 30%" },
  { name: "florist-shop", position: "50% 50%" },
  { name: "florist-display", position: "40% 50%" },
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
          <div className="grid justify-items-start gap-6" data-reveal>
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
            const Icon = BENEFIT_ICONS[i] ?? Gift;
            return (
              <li key={i} className="hm-benefit" data-reveal style={{ ["--d" as string]: i }}>
                <span className="hm-benefit__icon" aria-hidden>
                  <Icon size={22} weight="light" />
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
        <div className="grid justify-items-start gap-5" data-reveal>
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
        <div className="hm-pricing__visual" data-reveal style={{ ["--d" as string]: 1 }}>
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
const TRUST_ICONS = [Eye, LockSimple, DeviceMobile, ArrowCounterClockwise];

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
              const Icon = TRUST_ICONS[i] ?? Eye;
              return (
                <li key={i} className="hm-trust__item" data-reveal style={{ ["--d" as string]: i }}>
                  <Icon size={24} weight="light" aria-hidden />
                  <div>
                    <h3 className="hm-h3">{it.title}</h3>
                    <p className="hm-body mt-1">{it.text}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="hm-faq" data-reveal>
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
export async function Finale() {
  const { text } = await getLanding();
  return (
    <section className="hm-finale" aria-labelledby="hm-finale-title">
      <div className="hm-finale__photo" aria-hidden>
        <Photo name="gift-hands-cafe" alt="" sizes="100vw" position="55% 50%" />
      </div>
      <div className="hm-wrap hm-finale__inner">
        <span className="hm-finale__seal" aria-hidden>
          <WaxSeal />
        </span>
        <RevealText id="hm-finale-title" text={text("finale.title")} className="hm-title hm-finale__title" />
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
