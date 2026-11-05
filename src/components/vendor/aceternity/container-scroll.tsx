"use client";

/*
 * Container scroll — adapted from Aceternity UI "Container Scroll Animation"
 * (https://ui.aceternity.com/components/container-scroll-animation),
 * registry file registry/container-scroll-animation.json, fetched
 * 2026-10-22. Licence: Aceternity UI licence (https://ui.aceternity.com/licence):
 * commercial end products allowed; not to be resold as a template or theme.
 * Marketing page only, never a greeting theme (QR-STARR-DESIGN-ARSENAL §1.4).
 *
 * Kept: a framed surface that starts tilted back (rotateX 20°) and rises
 * flat, with a slight scale, as its section scrolls through the viewport.
 * Changed: the title is the section's own header (no translated header
 * slot); heights are set by the caller's CSS instead of a fixed 60–80rem;
 * phones (≤ 768px) and reduced motion get the flat card with no transform;
 * the frame takes the Signature materials (home.css .hm-cscroll).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useScroll, useTransform, motion, useReducedMotion } from "motion/react";

export function ContainerScroll({ children, className = "" }: { children: ReactNode; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: containerRef, offset: ["start end", "center center"] });
  const [isMobile, setIsMobile] = useState(true);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const still = isMobile || !!reduce;
  const rotate = useTransform(scrollYProgress, [0, 1], still ? [0, 0] : [20, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], still ? [1, 1] : [1.05, 1]);

  return (
    <div ref={containerRef} className={`hm-cscroll ${className}`} style={{ perspective: "1000px" }}>
      <motion.div style={{ rotateX: rotate, scale }} className="hm-cscroll__card">
        <div className="hm-cscroll__screen">{children}</div>
      </motion.div>
    </div>
  );
}
