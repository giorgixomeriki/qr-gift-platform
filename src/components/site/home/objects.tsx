import type { ReactNode } from "react";
import { Play } from "@phosphor-icons/react/dist/ssr/Play";
import { LinkSimple } from "@phosphor-icons/react/dist/ssr/LinkSimple";
import { Spark } from "@/components/ui/logo";
import { WaxSeal } from "@/components/customer/wax-seal";

/**
 * The home page's illustrated objects: the printed QR card, the phone, and
 * the greeting screens a recipient moves through. Drawn in HTML/CSS
 * (home.css) so every word on them is live, translatable text, and nothing
 * is a screenshot that could drift from the product. All decorative: the
 * sections that use them describe the same thing in text.
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

export function Phone({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`hm-phone ${className}`}>
      <div className="hm-phone__screen">
        <span className="hm-phone__island" />
        {children}
      </div>
    </div>
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

/** The opened greeting: the letter, two prints and the voice note. */
export function LetterScreen({ copy, withKeepsakes = true, active, className = "" }: { copy: SampleCopy; withKeepsakes?: boolean; active?: boolean; className?: string }) {
  return (
    <div className={`hm-screen ${className}`} data-active={active || undefined}>
      <span className="hm-screen__tag">{copy.tag}</span>
      <span className="hm-screen__kicker">{copy.to}</span>
      <div className="hm-letter">
        <p className="hm-letter__text">{copy.text}</p>
        <p className="hm-letter__sign">{copy.sign}</p>
      </div>
      {withKeepsakes && (
        <>
          <div className="hm-prints">
            <span className="hm-print hm-print--a">
              <span className="hm-img-letter" />
            </span>
            <span className="hm-print hm-print--b">
              <span className="hm-img-stars" />
            </span>
          </div>
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

export function ScanScreen({ svg, cardLine, pill, active }: { svg: string; cardLine: string; pill: string; active?: boolean }) {
  return (
    <div className="hm-screen hm-screen--scan" data-active={active || undefined}>
      <QrCard svg={svg} line={cardLine} seal={false} className="hm-scan__card" />
      <span className="hm-scan__frame" />
      <span className="hm-scan__pill">
        <LinkSimple weight="bold" />
        {pill}
      </span>
    </div>
  );
}

export function OpenScreen({ to, cta, active }: { to: string; cta: string; active?: boolean }) {
  return (
    <div className="hm-screen hm-screen--open" data-active={active || undefined}>
      <span className="hm-screen__kicker">{to}</span>
      <span className="hm-envelope">
        <WaxSeal className="hm-envelope__seal" />
      </span>
      <span className="hm-screen__cta">{cta}</span>
    </div>
  );
}

export function KeepScreen({ copy, active }: { copy: SampleCopy; active?: boolean }) {
  return (
    <div className="hm-screen hm-screen--keep" data-active={active || undefined}>
      <span className="hm-screen__kicker">{copy.to}</span>
      <div className="hm-prints" style={{ marginTop: 0 }}>
        <span className="hm-print hm-print--a">
          <span className="hm-img-letter" />
        </span>
        <span className="hm-print hm-print--b">
          <span className="hm-img-room" />
        </span>
      </div>
      <span className="hm-video hm-img-stars">
        <span className="hm-video__play">
          <Play weight="fill" />
        </span>
      </span>
      <VoiceRow label={copy.voice} />
    </div>
  );
}
