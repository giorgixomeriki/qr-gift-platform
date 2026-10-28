import type { ReactNode } from "react";
import { Play } from "@phosphor-icons/react/dist/ssr/Play";
import { LinkSimple } from "@phosphor-icons/react/dist/ssr/LinkSimple";
import { Spark } from "@/components/ui/logo";
import { WaxSeal } from "@/components/customer/wax-seal";
import { Iphone } from "@/components/vendor/magicui/iphone";
import { Photo } from "./photo";

/**
 * The home page's product objects: the printed QR card (our own artwork,
 * rendered live, never a stock photo of somebody else's card), the phone
 * (Magic UI's iPhone frame with live HTML in its screen), and the greeting
 * screens a recipient moves through. Every word on them is translatable
 * text. Decorative: the sections that use them say the same thing in words.
 */

export function QrCard({ svg, line, hint, seal = true, className = "" }: { svg: string; line: string; hint?: string; seal?: boolean; className?: string }) {
  return (
    <div className={`hm-qrcard hm-paper ${className}`}>
      <span className="hm-qrcard__brand">
        <Spark />
        <span>
          QR <span className="font-serif italic">Starr</span>
        </span>
      </span>
      <span className="hm-qrcard__code" dangerouslySetInnerHTML={{ __html: svg }} />
      <span className="hm-qrcard__line">{line}</span>
      {hint && <span className="hm-qrcard__hint">{hint}</span>}
      {seal && <WaxSeal className="hm-qrcard__seal" />}
    </div>
  );
}

/** Magic UI's iPhone in the Signature materials, with a status bar over the live screen. */
export function PhoneShell({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <Iphone className={`hm-iphone ${className}`}>
      <div className="hm-phone__screen">
        <span className="hm-phone__status">
          <span>9:41</span>
          <span className="hm-phone__glyphs">
            <i className="hm-glyph-signal" />
            <i className="hm-glyph-battery" />
          </span>
        </span>
        {children}
      </div>
    </Iphone>
  );
}

const WAVE = [38, 62, 84, 52, 96, 70, 44, 80, 58, 90, 48, 66, 36, 74, 54, 30];

export function Wave({ className = "hm-wave", count = WAVE.length }: { className?: string; count?: number }) {
  return (
    <span className={className}>
      {WAVE.slice(0, count).map((h, i) => (
        <i key={i} style={{ height: `${h}%`, ["--i" as string]: i }} />
      ))}
    </span>
  );
}

export type SampleCopy = { to: string; text: string; sign: string; voice: string; tag: string };

function Prints() {
  return (
    <div className="hm-prints">
      <span className="hm-print hm-print--a">
        <Photo name="keepsake-picnic" alt="" sizes="120px" />
      </span>
      <span className="hm-print hm-print--b">
        <Photo name="keepsake-hug" alt="" sizes="120px" />
      </span>
    </div>
  );
}

/** The opened greeting: the letter, two prints and the voice note. `letter` replaces the plain text (the demo animates it). */
export function LetterScreen({ copy, withKeepsakes = true, letter }: { copy: SampleCopy; withKeepsakes?: boolean; letter?: ReactNode }) {
  return (
    <div className="hm-screen">
      <span className="hm-screen__tag">{copy.tag}</span>
      <span className="hm-screen__kicker">{copy.to}</span>
      <div className="hm-letter">
        {letter ?? <p className="hm-letter__text">{copy.text}</p>}
        <p className="hm-letter__sign">{copy.sign}</p>
      </div>
      {withKeepsakes && (
        <>
          <Prints />
          <VoiceRow label={copy.voice} />
        </>
      )}
    </div>
  );
}

function VoiceRow({ label }: { label: string }) {
  return (
    <div className="hm-voice">
      <span className="hm-voice__play">
        <Play weight="fill" />
      </span>
      <Wave />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function ScanScreen({ svg, cardLine, pill }: { svg: string; cardLine: string; pill: string }) {
  return (
    <div className="hm-screen hm-screen--scan">
      <Photo name="sealed-letter" alt="" sizes="260px" className="hm-scan__view" />
      <QrCard svg={svg} line={cardLine} seal={false} className="hm-scan__card" />
      <span className="hm-scan__frame" />
      <span className="hm-scan__pill">
        <LinkSimple weight="bold" />
        {pill}
      </span>
    </div>
  );
}

export function OpenScreen({ to, cta }: { to: string; cta: string }) {
  return (
    <div className="hm-screen hm-screen--open">
      <span className="hm-screen__kicker">{to}</span>
      <span className="hm-envelope">
        <WaxSeal className="hm-envelope__seal" />
      </span>
      <span className="hm-screen__cta">{cta}</span>
    </div>
  );
}

export function KeepScreen({ copy }: { copy: SampleCopy }) {
  return (
    <div className="hm-screen hm-screen--keep">
      <span className="hm-screen__kicker">{copy.to}</span>
      <Prints />
      <span className="hm-video">
        <Photo name="gift-hands-cafe" alt="" sizes="240px" />
        <span className="hm-video__play">
          <Play weight="fill" />
        </span>
      </span>
      <VoiceRow label={copy.voice} />
    </div>
  );
}

/**
 * Our card composited into a licensed photograph of a wax-sealed envelope
 * (envelope-seal): an accurate mockup of the product, never a stock photo
 * presented as one. The overlay is positioned in the photo's own
 * coordinates, so the frame keeps the photo's aspect ratio.
 */
export function CardComposite({ svg, line, alt, sizes, className = "" }: { svg: string; line: string; alt: string; sizes: string; className?: string }) {
  return (
    <div className={`hm-composite ${className}`} role="img" aria-label={alt}>
      <Photo name="envelope-seal" alt="" sizes={sizes} />
      <QrCard svg={svg} line={line} seal className="hm-composite__card" />
    </div>
  );
}
