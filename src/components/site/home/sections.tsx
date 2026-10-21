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
import { ThemeSwatch } from "@/components/greeting/theme-swatch";
import { WaxSeal } from "@/components/customer/wax-seal";
import { Spark } from "@/components/ui/logo";
import { SELECTABLE_THEMES } from "@/lib/themes/registry";
import { getHomeQrSvg, getLanding } from "./copy";
import { KeepScreen, LetterScreen, OpenScreen, ScanScreen, Wave } from "./objects";
import { ScanDemo } from "./scan-demo";

/*
 * The home page's sections, top to bottom. Each is a server component that
 * reads its own copy; only the scan demo and the reveal observer run in the
 * browser.
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

/* --------------------------------------------------------------- demo */
export async function Demo() {
  const { text, raw, rich } = await getLanding();
  const svg = await getHomeQrSvg();
  const sample = { to: text("hero.sampleTo"), text: text("hero.sampleText"), sign: text("hero.sampleSign"), voice: text("hero.sampleVoice"), tag: text("hero.sampleTag") };
  const beats = raw<{ label: string; title: string }[]>("demo.beats").map((b, i) => ({ ...b, text: rich(`demo.beats.${i}.text`) }));

  return (
    <section className="hm-section" id="after-scan" aria-labelledby="hm-demo-title">
      <div className="hm-wrap">
        <Head id="hm-demo-title" eyebrow={text("demo.eyebrow")} title={text("demo.title")} lead={text("demo.lead")} />
        <div className="mt-[clamp(2.5rem,1.5rem+3vw,4rem)]" data-reveal>
          <ScanDemo
            beats={beats}
            labels={{ tabs: text("demo.tabsLabel") }}
            screens={[
              <ScanScreen key="scan" svg={svg} cardLine={text("hero.cardLine")} pill="qrapp.ge" />,
              <OpenScreen key="open" to={sample.to} cta={text("demo.screenOpen")} />,
              <LetterScreen key="read" copy={{ ...sample, text: `${sample.text} ${text("experiences.letterSample")}` }} withKeepsakes={false} />,
              <KeepScreen key="keep" copy={sample} />,
            ]}
          />
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- steps */
const STEP_ICONS = [Storefront, DeviceMobileCamera, EnvelopeOpen];

export async function Steps() {
  const { text, raw } = await getLanding();
  const items = raw<Item[]>("steps.items");
  return (
    <section className="hm-section hm-section--tight" id="how" aria-labelledby="hm-steps-title" style={{ background: "var(--hm-paper-2)" }}>
      <div className="hm-wrap">
        <Head id="hm-steps-title" eyebrow={text("steps.eyebrow")} title={text("steps.title")} />
        <ol className="hm-steps">
          {items.map((s, i) => {
            const Icon = STEP_ICONS[i] ?? Gift;
            return (
              <li key={i} className="hm-step hm-paper" data-reveal style={{ ["--d" as string]: i }}>
                <div className="hm-step__top">
                  <span className="hm-step__num hm-numeral" aria-hidden>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="hm-step__icon" aria-hidden>
                    <Icon size={22} weight="light" />
                  </span>
                </div>
                <h3 className="hm-h3">{s.title}</h3>
                <p className="hm-body">{s.text}</p>
              </li>
            );
          })}
        </ol>
        <p className="mt-8" data-reveal>
          <Link href="/how-it-works" className="hm-link">
            {text("steps.more")}
            <ArrowRight size={16} aria-hidden />
          </Link>
        </p>
      </div>
    </section>
  );
}

/* -------------------------------------------------------- experiences */
export async function Experiences() {
  const { text, rich } = await getLanding();
  const tApp = await getTranslations("themes");
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
    <section className="hm-section" id="greetings" aria-labelledby="hm-exp-title">
      <div className="hm-wrap">
        <Head id="hm-exp-title" eyebrow={text("experiences.eyebrow")} title={text("experiences.title")} lead={text("experiences.lead")} />
        <ul className="hm-bento">
          <li className="hm-tile hm-tile--letter hm-paper" data-reveal>
            <div className="hm-tile__art" aria-hidden>
              <p className="hm-tile__letter">
                {text("experiences.letterSample")}
                <span className="hm-tile__caret" />
              </p>
            </div>
            {tile("message", PenNib)}
          </li>
          <li className="hm-tile hm-tile--photos hm-paper" data-reveal style={{ ["--d" as string]: 1 }}>
            <div className="hm-tile__art" aria-hidden>
              <span className="hm-fan">
                <span className="hm-print">
                  <span className="hm-img-letter" />
                </span>
                <span className="hm-print">
                  <span className="hm-img-room" />
                </span>
                <span className="hm-print">
                  <span className="hm-img-stars" />
                </span>
              </span>
            </div>
            {tile("photos", ImageIcon)}
          </li>
          <li className="hm-tile hm-tile--video hm-paper" data-reveal>
            <div className="hm-tile__art hm-img-stars" aria-hidden>
              <span className="hm-tile__play">
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
const OCCASION_THEMES = ["birthday", "romantic", "elegant", "wedding", "celebration", "minimal"] as const;

export async function Occasions() {
  const { text, raw } = await getLanding();
  const tApp = await getTranslations("themes");
  const items = raw<Item[]>("occasions.items");
  return (
    <section className="hm-section" id="occasions" aria-labelledby="hm-occ-title" style={{ paddingTop: 0 }}>
      <div className="hm-wrap">
        <Head id="hm-occ-title" eyebrow={text("occasions.eyebrow")} title={text("occasions.title")} lead={text("occasions.lead")} />
        <ul className="hm-occasions" aria-label={text("occasions.listLabel")}>
          {items.map((o, i) => {
            const theme = OCCASION_THEMES[i] ?? "minimal";
            return (
              <li key={i} className="hm-occasion hm-paper" data-reveal style={{ ["--d" as string]: i % 3 }}>
                <ThemeSwatch themeKey={theme} line={tApp(`${theme}.opening`)} className="hm-occasion__art" />
                <h3 className="hm-h3">{o.title}</h3>
                <p className="hm-body">{o.text}</p>
                <p className="hm-occasion__design">
                  {text("occasions.designLabel")}: {tApp(`${theme}.name`)}
                </p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------- partners */
const BENEFIT_ICONS = [Gift, Printer, ChartLineUp, EyeSlash];

export async function Partners() {
  const { text, raw } = await getLanding();
  const svg = await getHomeQrSvg();
  const items = raw<Item[]>("partners.items");
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
          <div className="hm-sheet hm-paper" role="img" aria-label={text("partners.sheetLabel")} data-reveal style={{ ["--d" as string]: 1 }}>
            <div className="hm-sheet__grid">
              {Array.from({ length: 6 }, (_, i) => (
                <span key={i} className="hm-sheet__card">
                  <Spark className="hm-sheet__mark" />
                  <span className="hm-sheet__qr contents" dangerouslySetInnerHTML={{ __html: svg.replace("<svg ", '<svg class="hm-sheet__qr" ') }} />
                </span>
              ))}
            </div>
          </div>
        </div>
        <ul className="hm-benefits">
          {items.map((b, i) => {
            const Icon = BENEFIT_ICONS[i] ?? Gift;
            return (
              <li key={i} className="hm-benefit" data-reveal style={{ ["--d" as string]: i }}>
                <Icon className="hm-benefit__icon" size={26} weight="light" aria-hidden />
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
        <div className="hm-slip hm-paper" data-reveal data-testid="home-price" style={{ ["--d" as string]: 1 }}>
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
      <div className="hm-wrap">
        <Head id="hm-trust-title" eyebrow={text("trust.eyebrow")} title={text("trust.title")} />
        <ul className="hm-trust">
          {items.map((it, i) => {
            const Icon = TRUST_ICONS[i] ?? Eye;
            return (
              <li key={i} className="hm-trust__item" data-reveal style={{ ["--d" as string]: i }}>
                <Icon size={26} weight="light" aria-hidden />
                <h3 className="hm-h3">{it.title}</h3>
                <p className="hm-body">{it.text}</p>
              </li>
            );
          })}
        </ul>
        <div className="hm-faq">
          <h2 className="hm-title" data-reveal>
            {text("trust.faqTitle")}
          </h2>
          <div className="hm-faq__list" data-reveal>
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
      <div className="hm-wrap grid justify-items-center" data-reveal>
        <span className="hm-finale__seal" aria-hidden>
          <WaxSeal />
        </span>
        <h2 id="hm-finale-title" className="hm-title max-w-3xl">
          {text("finale.title")}
        </h2>
        <p className="hm-lead mx-auto mt-5">{text("finale.body")}</p>
        <div className="hm-actions hm-actions--stack">
          <Link href="/how-it-works" className="hm-btn hm-btn--primary">
            {text("finale.primary")}
            <Arrow />
          </Link>
          <Link href="/contact" className="hm-btn hm-btn--quiet">
            {text("finale.secondary")}
          </Link>
        </div>
      </div>
    </section>
  );
}
