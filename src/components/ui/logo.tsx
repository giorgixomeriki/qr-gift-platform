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
