"use client";

import { useEffect } from "react";

/**
 * Marks [data-reveal] blocks inside `.hm` as they enter the viewport (home.css
 * fades them up). Anything already on screen is marked before the page is
 * flagged ready, so nothing visible ever blinks out; without JavaScript, or
 * under reduced motion, everything simply stays visible.
 */
export function RevealObserver() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".hm");
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const blocks = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    const vh = window.innerHeight;
    for (const el of blocks) if (el.getBoundingClientRect().top < vh * 0.92) el.dataset.inview = "";
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          (e.target as HTMLElement).dataset.inview = "";
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    for (const el of blocks) if (!("inview" in el.dataset)) io.observe(el);
    root.dataset.revealReady = "";
    return () => io.disconnect();
  }, []);
  return null;
}
