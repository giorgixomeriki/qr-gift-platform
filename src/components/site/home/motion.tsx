"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { MotionConfig, motion, useInView, useReducedMotion, useScroll, useTransform } from "motion/react";
import { TextEffect } from "@/components/vendor/motion-primitives/text-effect";
import { Tilt } from "@/components/vendor/motion-primitives/tilt";
import Stack from "@/components/vendor/reactbits/stack";

/*
 * The home page's motion layer. Everything here is progressive: the server
 * renders the finished, still composition, and motion only adds to it after
 * hydration. Reduced motion (MotionConfig "user" + explicit checks) keeps
 * every element at rest.
 */

export function MotionRoot({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/** Hero depth: as the page scrolls away, the phone rises a little faster than the photograph and the card settles. */
export function HeroStage({ photo, plate, card, phone, badges, label }: { photo: ReactNode; plate?: ReactNode; card: ReactNode; phone: ReactNode; badges: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const phoneY = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : -70]);
  const cardY = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : 30]);
  const photoScale = useTransform(scrollYProgress, [0, 1], [1, reduce ? 1 : 1.06]);
  const plateY = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : 40]);
  return (
    <div ref={ref} className="hm-hstage" role="img" aria-label={label}>
      {plate && (
        <motion.div className="hm-hstage__plate" style={{ y: plateY }}>
          {plate}
        </motion.div>
      )}
      <motion.div className="hm-hstage__photo" style={{ scale: photoScale }}>
        {photo}
      </motion.div>
      <motion.div className="hm-hstage__card" style={{ y: cardY }}>
        {card}
      </motion.div>
      <motion.div className="hm-hstage__phone" style={{ y: phoneY }}>
        {phone}
      </motion.div>
      {badges}
    </div>
  );
}

/**
 * A heading whose words arrive one by one when it scrolls into view
 * (Motion Primitives TextEffect). Rendered as plain text on the server and
 * for reduced motion; hidden only once hydrated, and only if off screen.
 */
export function RevealText({ text, as = "h2", className, id }: { text: string; as?: "h2" | "p"; className?: string; id?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });
  const reduce = useReducedMotion();
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || reduce) return;
    if (el.getBoundingClientRect().top > window.innerHeight) setArmed(true);
  }, [reduce]);
  const Tag = as;
  // The id sits on the wrapper so aria-labelledby keeps working once the
  // animated element (which takes no id) replaces the plain one.
  return (
    <div ref={ref} id={id}>
      {armed ? (
        inView ? (
          <TextEffect as={as} per="word" preset="fade-in-blur" speedReveal={1.1} className={className}>
            {text}
          </TextEffect>
        ) : (
          <Tag className={className} style={{ opacity: 0 }}>
            {text}
          </Tag>
        )
      ) : (
        <Tag className={className}>
          {text}
        </Tag>
      )}
    </div>
  );
}

/** Motion Primitives Tilt, only for a fine pointer and never under reduced motion. */
export function TiltCard({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  const [fine, setFine] = useState(false);
  useEffect(() => setFine(window.matchMedia("(hover: hover) and (pointer: fine)").matches), []);
  if (!fine || reduce) return <div className={className}>{children}</div>;
  return (
    <Tilt className={className} rotationFactor={6} springOptions={{ stiffness: 160, damping: 20, mass: 0.6 }}>
      {children}
    </Tilt>
  );
}

/** React Bits Stack: prints you can flick through, as a recipient would. */
export function PhotoStack({ cards, label }: { cards: ReactNode[]; label: string }) {
  return (
    <Stack
      cards={cards}
      layout="pile"
      spread={0.55}
      depth={0.4}
      radius={6}
      frame={8}
      frameColor="#fbf7f0"
      tilt={18}
      threshold={70}
      sendToBackOnClick
      label={label}
      className="hm-pstack"
    />
  );
}

/* ------------------------------------------- the demo's active moment */
const BeatContext = createContext(0);
export const BeatProvider = BeatContext.Provider;

/** The letter in the "Read" moment writes itself in, word by word, each time that moment opens. */
export function DemoLetterText({ text, beat, className }: { text: string; beat: number; className?: string }) {
  const active = useContext(BeatContext) === beat;
  const reduce = useReducedMotion();
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (active) setRound((r) => r + 1);
  }, [active]);
  if (reduce || round === 0) return <p className={className}>{text}</p>;
  return (
    <TextEffect key={round} per="word" preset="fade-in-blur" speedReveal={0.9} className={className}>
      {text}
    </TextEffect>
  );
}
