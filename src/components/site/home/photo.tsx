import type { CSSProperties } from "react";
import { PHOTOS, type PhotoName } from "./photos";

/**
 * A licensed photograph or public-domain artwork (public/site, register in
 * docs/design/site-redesign/ASSETS.md) as a responsive <picture>: AVIF with
 * a WebP fallback at every encoded width, intrinsic width/height so the
 * layout never shifts, lazy by default and eager + high priority for the
 * one photo that is the page's largest paint.
 *
 * Pre-encoded at build time rather than through next/image: the host's free
 * instance sleeps and has an ephemeral disk, so on-demand optimisation would
 * re-encode on every cold start.
 */
export function Photo({
  name,
  alt,
  sizes,
  priority = false,
  className = "",
  style,
  position,
}: {
  name: PhotoName;
  /** Empty for decorative use inside an already-described composition. */
  alt: string;
  /** The rendered width, e.g. "(min-width: 62rem) 40vw, 90vw". */
  sizes: string;
  priority?: boolean;
  className?: string;
  style?: CSSProperties;
  /** object-position, e.g. "50% 30%". */
  position?: string;
}) {
  const p = PHOTOS[name];
  const dir = "dir" in p ? p.dir : "photos";
  const set = (ext: "avif" | "webp") => p.widths.map((w) => `/site/${dir}/${name}-${w}.${ext} ${w}w`).join(", ");
  const fallback = `/site/${dir}/${name}-${p.widths[Math.min(1, p.widths.length - 1)]}.webp`;
  return (
    <picture className={`hm-photo ${className}`} style={style}>
      <source type="image/avif" srcSet={set("avif")} sizes={sizes} />
      <source type="image/webp" srcSet={set("webp")} sizes={sizes} />
      <img
        src={fallback}
        alt={alt}
        width={p.w}
        height={p.h}
        loading={priority ? "eager" : "lazy"}
        decoding={priority ? "sync" : "async"}
        fetchPriority={priority ? "high" : "auto"}
        draggable={false}
        style={position ? { objectPosition: position } : undefined}
      />
    </picture>
  );
}
