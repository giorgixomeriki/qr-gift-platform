import { useId } from "react";
import { SPARK_PATH } from "@/components/ui/logo";

/**
 * QR Starr's blind emboss — the maker's mark a stationer presses into the
 * back of a card: the Starr spark, raised out of the paper with no ink.
 * Only its edges exist, lit the way the scene is lit (window
 * upper-left): a bright rim where the relief faces the light, a soft shade
 * where it turns away. At reading distance it is barely there; it rewards a
 * closer look.
 *
 * The rims come from the shape's own alpha: the shape minus a copy of itself
 * nudged down-right leaves the upper-left edges (lit), minus a copy nudged
 * up-left leaves the lower-right edges (shade).
 */
export function StarrEmboss({ className = "" }: { className?: string }) {
  const id = `emboss${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden focusable="false">
      <defs>
        <filter id={id} x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
          <feOffset in="SourceAlpha" dx="0.7" dy="0.7" result="down" />
          <feOffset in="SourceAlpha" dx="-0.6" dy="-0.6" result="up" />
          <feComposite in="SourceAlpha" in2="down" operator="out" result="litEdge" />
          <feComposite in="SourceAlpha" in2="up" operator="out" result="shadeEdge" />
          <feFlood floodColor="#fffdf8" floodOpacity="0.95" />
          <feComposite in2="litEdge" operator="in" result="lit" />
          <feFlood floodColor="#5b4535" floodOpacity="0.34" />
          <feComposite in2="shadeEdge" operator="in" result="shade" />
          <feMerge result="rims">
            <feMergeNode in="shade" />
            <feMergeNode in="lit" />
          </feMerge>
          <feGaussianBlur in="rims" stdDeviation="0.22" />
        </filter>
      </defs>
      <g filter={`url(#${id})`}>
        <path d={SPARK_PATH} transform="translate(4 4) scale(1.3333)" />
      </g>
    </svg>
  );
}
