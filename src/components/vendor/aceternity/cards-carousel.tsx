"use client";

/*
 * Cards carousel — adapted from Aceternity UI "Apple Cards Carousel"
 * (https://ui.aceternity.com/components/apple-cards-carousel), registry file
 * registry/apple-cards-carousel.json, fetched 2026-10-21. Licence: Aceternity
 * UI licence (https://ui.aceternity.com/licence): commercial end products
 * allowed; the item may not be resold as a template or theme. Used here in
 * QR Starr's own marketing page only (never in a greeting theme, per
 * docs/design/QR-STARR-DESIGN-ARSENAL.md §1.4).
 *
 * Kept: the horizontally scrolling row of tall cards, the staggered entrance
 * (motion), the scroll-by arrows that disable at either end.
 * Changed: no expand-to-modal (the cards are figures, not dialogs); native
 * scroll-snap; arrows are labelled buttons with Phosphor icons instead of
 * @tabler/icons-react; no next/image (cards bring their own <picture>);
 * colours and radii come from home.css; the row is a labelled list.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { ArrowLeft } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { ArrowRight } from "@phosphor-icons/react/dist/csr/ArrowRight";

export function CardsCarousel({ items, label, labels }: { items: ReactNode[]; label: string; labels: { previous: string; next: string } }) {
  const ref = useRef<HTMLUListElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(true);

  const check = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  useEffect(() => {
    check();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [check]);

  const by = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const card = el.querySelector("li");
    const step = card ? card.getBoundingClientRect().width + 20 : 320;
    el.scrollBy({ left: dir * step, behavior: "smooth" });
  };

  return (
    <div className="hm-carousel">
      <ul ref={ref} className="hm-carousel__row" aria-label={label} onScroll={check}>
        {items.map((item, i) => (
          <motion.li
            key={i}
            className="hm-carousel__item"
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.6, delay: Math.min(i, 5) * 0.08, ease: [0.22, 1, 0.36, 1] }}
          >
            {item}
          </motion.li>
        ))}
      </ul>
      <div className="hm-carousel__nav">
        <button type="button" onClick={() => by(-1)} disabled={!canLeft} aria-label={labels.previous} className="hm-carousel__btn">
          <ArrowLeft size={18} weight="bold" aria-hidden />
        </button>
        <button type="button" onClick={() => by(1)} disabled={!canRight} aria-label={labels.next} className="hm-carousel__btn">
          <ArrowRight size={18} weight="bold" aria-hidden />
        </button>
      </div>
    </div>
  );
}
