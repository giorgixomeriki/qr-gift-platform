import { useId } from "react";
import { SPARK_PATH } from "@/components/ui/logo";

/**
 * QR Starr's wax seal: a custom brand asset, drawn as inline SVG so it stays
 * crisp at any size, costs no request, and can be recoloured per theme via
 * the --cx-seal-* tokens (globals.css).
 *
 * Layers: contact shadow → pooled wax (edge roughened with a turbulence
 * displacement, the way wax spreads unevenly) → the pressed disc with a
 * bevelled rim → the Starr spark debossed into it (dark inner edge top-left,
 * lit lip bottom-right) → a soft specular highlight.
 *
 * The press (globals.css, .cx-scene__seal): the seal comes down and the wax
 * spreads under it (pool), the Starr impression appears as the stamp lifts
 * (impress), fresh wax catches the light once (glint), and three motes of
 * dust drift up in the window light and are gone (mote). Every layer ends
 * in its resting state, so reduced motion shows the finished seal.
 *
 * Decorative only; callers render it inside an aria-hidden container.
 */
export function WaxSeal({ className = "" }: { className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const wax = `wax${id}`;
  const rough = `rough${id}`;
  const rim = `rim${id}`;
  const soft = `soft${id}`;

  return (
    <svg viewBox="0 0 100 100" overflow="visible" className={className} aria-hidden focusable="false">
      <defs>
        <radialGradient id={wax} cx="36%" cy="30%" r="75%">
          <stop offset="0%" style={{ stopColor: "var(--cx-seal-hi)" }} />
          <stop offset="48%" style={{ stopColor: "var(--cx-seal-mid)" }} />
          <stop offset="100%" style={{ stopColor: "var(--cx-seal-lo)" }} />
        </radialGradient>
        <linearGradient id={rim} x1="15%" y1="10%" x2="85%" y2="90%">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.38" />
          <stop offset="55%" stopColor="#fff" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.38" />
        </linearGradient>
        <filter id={rough} x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="2" seed="7" />
          <feDisplacementMap in="SourceGraphic" scale="6" />
        </filter>
        <filter id={soft} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
      </defs>

      {/* contact shadow */}
      <ellipse cx="51" cy="56" rx="43" ry="40" fill="#1a0a10" opacity="0.32" filter={`url(#${soft})`} />
      {/* pooled wax */}
      <circle className="cx-seal__pool" cx="50" cy="50" r="44" fill={`url(#${wax})`} filter={`url(#${rough})`} />
      {/* pressed disc and its bevelled rim */}
      <circle cx="50" cy="50" r="31.5" fill={`url(#${wax})`} />
      <g className="cx-seal__impress">
        <circle cx="50" cy="50" r="31.5" fill="none" stroke={`url(#${rim})`} strokeWidth="2.2" />
        <circle cx="50" cy="50" r="34.5" fill="none" stroke="#000" strokeOpacity="0.14" strokeWidth="1.4" />
        {/* the Starr spark, debossed */}
        <g transform="translate(32.6 32.6) scale(1.45)">
          <path d={SPARK_PATH} fill="#fff" fillOpacity="0.42" transform="translate(0.55 0.6)" />
          <path d={SPARK_PATH} fill="#000" fillOpacity="0.45" transform="translate(-0.45 -0.45)" />
          <path d={SPARK_PATH} style={{ fill: "var(--cx-seal-lo)" }} />
        </g>
      </g>
      {/* soft specular highlight */}
      <ellipse
        className="cx-seal__glint"
        cx="36"
        cy="30"
        rx="11"
        ry="6.5"
        fill="#fff"
        opacity="0.18"
        transform="rotate(-28 36 30)"
        filter={`url(#${soft})`}
      />
      {/* dust in the window light, stirred by the press */}
      <circle className="cx-seal__mote" cx="12" cy="24" r="1.5" fill="#fffaf0" />
      <circle className="cx-seal__mote cx-seal__mote--b" cx="90" cy="34" r="1.1" fill="#fffaf0" />
      <circle className="cx-seal__mote cx-seal__mote--c" cx="22" cy="86" r="1.3" fill="#fffaf0" />
    </svg>
  );
}
