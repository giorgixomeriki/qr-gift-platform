import type { CSSProperties } from "react";

/**
 * The "spark" — a four-point star that is QR Starr's one recurring motif:
 * it's the mark, the wax seal on the recipient envelope, and the burst on
 * reveal. Drawn as a single path so it scales cleanly from 12px to 120px.
 */
export const SPARK_PATH = "M12 .5Q13.3 10.7 23.5 12 13.3 13.3 12 23.5 10.7 13.3 .5 12 10.7 10.7 12 .5Z";

export function Spark({ className = "size-5", title, style }: { className?: string; title?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" className={className} style={style} role={title ? "img" : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <path fill="currentColor" d={SPARK_PATH} />
    </svg>
  );
}

export function Logo({ className = "", tone = "ink" }: { className?: string; tone?: "ink" | "inverse" }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-medium tracking-[-0.01em] ${
        tone === "inverse" ? "text-white" : "text-ink"
      } ${className}`}
    >
      <Spark className="size-[1.1em] text-ember" />
      <span>
        QR <span className="font-serif italic">Starr</span>
      </span>
    </span>
  );
}

/**
 * The Heritage lockup — the ringed "Q" monogram beside the "QR STARR"
 * wordmark, fully outlined (no font dependency) in brand burgundy #6d1f33.
 * The same monogram is the favicon and app icon (src/app/icon.svg,
 * favicon.ico, apple-icon.png). Served as a cached static SVG rather than
 * inlined, so it doesn't add ~20 KB of path data to every HTML response.
 * viewBox 198.05 × 68 → width is height × 2.9125.
 */
export function BrandLockup({ className = "h-9 w-auto" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static SVG; next/image adds nothing for a vector
    <img src="/brand/qr-starr-lockup.svg" alt="QR Starr" width={198} height={68} decoding="async" className={`block select-none ${className}`} draggable={false} />
  );
}
