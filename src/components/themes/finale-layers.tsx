import type { ComponentType } from "react";
import { SPARK_PATH } from "@/components/ui/logo";
import type { FinaleId } from "@/lib/templates/vocabulary";

/**
 * Artwork a finale adds to its world, placed on the card (theme-world.tsx).
 * Most finales only move the world's own elements; those that need a piece
 * of their own register it here, by finale id. Styled in theme-world.css
 * ("Finales"); hidden while the world is held before the finale plays.
 */
export const FINALE_LAYERS: Partial<Record<FinaleId, ComponentType>> = {
  "paper-encore": Rosette,
};

/** A rosette cut from paper: a zig-zag edge in the world's accent, a card-stock centre, the Starr. */
const ROSETTE_EDGE = Array.from({ length: 28 }, (_, i) => {
  const a = (i / 28) * Math.PI * 2;
  const r = i % 2 === 0 ? 20 : 16.6;
  return `${(20 + Math.cos(a) * r).toFixed(2)},${(20 + Math.sin(a) * r).toFixed(2)}`;
}).join(" ");

function Rosette() {
  return (
    <span className="tw-finale tw-finale--rosette">
      <svg viewBox="0 0 40 40" focusable="false">
        <polygon points={ROSETTE_EDGE} fill="var(--w-accent)" />
        <circle cx="20" cy="20" r="11.2" fill="var(--w-card)" />
        <path d={SPARK_PATH} fill="var(--w-accent-3)" transform="translate(13.4 13.4) scale(0.55)" />
      </svg>
    </span>
  );
}
