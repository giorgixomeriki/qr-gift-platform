'use client';

/*
 * BounceCards — React Bits (https://reactbits.dev/components/bounce-cards),
 * registry file BounceCards-TS-TW, fetched 2026-10-22. Licence: MIT +
 * Commons Clause (https://github.com/DavidHDev/react-bits/blob/main/LICENSE.md):
 * use in an application or website allowed; the component may not be sold
 * or redistributed on its own. Copyright (c) 2026 David Haz.
 *
 * QR Starr changes:
 * - cards take rendered nodes (a <picture>) as well as image URLs;
 * - cards may be portrait (`cardAspect`, width / height);
 * - the fan scales to its container's width (`fluid`);
 * - cards are server-rendered at rest in their slots, so they are visible
 *   without JavaScript; the pop-in entrance only plays when the fan is
 *   still below the fold at mount;
 * - non-null assertions for this project's noUncheckedIndexedAccess.
 * The physics, hover push and keyboard handling are unchanged.
 */

import React, { useEffect, useRef } from 'react';

export type BounceCardImage = string | { src?: string; alt?: string; node?: React.ReactNode };

export type BounceCardsProps = {
  images?: BounceCardImage[];
  className?: string;
  style?: React.CSSProperties;
  containerWidth?: number;
  containerHeight?: number;
  cardSize?: number;
  spread?: number;
  rotation?: number;
  arc?: number;
  animationDelay?: number;
  animationStagger?: number;
  bounciness?: number;
  enableHover?: boolean;
  pushDistance?: number;
  hoverScale?: number;
  borderWidth?: number;
  borderColor?: string;
  radius?: number;
  shadow?: boolean;
  transformStyles?: string[];
  onCardClick?: (index: number) => void;
  /** Card width / height; 1 is the original square. */
  cardAspect?: number;
  /** Scale the whole fan down to fit its parent's width. */
  fluid?: boolean;
};

type Slot = { x: number; y: number; rotate: number };

type Body = {
  x: number;
  y: number;
  rotate: number;
  scale: number;
  vx: number;
  vy: number;
  vr: number;
  vs: number;
  born: number;
};

const ROOT = 'relative touch-pan-y [-webkit-tap-highlight-color:transparent]';
const CARD =
  'absolute top-1/2 left-1/2 aspect-[var(--bounce-cards-aspect)] w-[var(--bounce-cards-size)] overflow-hidden rounded-[var(--bounce-cards-radius)] border-[length:var(--bounce-cards-border)] border-solid border-[color:var(--bounce-cards-border-color)] [background:var(--bounce-cards-border-color)] [box-shadow:var(--bounce-cards-shadow)] transition-shadow duration-300 will-change-transform data-[active]:[box-shadow:var(--bounce-cards-shadow-active)]';
const CLICKABLE =
  'cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[color:var(--bounce-cards-border-color)]';
const IMG = 'pointer-events-none block h-full w-full object-cover select-none';

const PATTERN = [1, 0.5, -0.3, -1, 0.2, 0.75, -0.6, 0.35, -0.85, 0.1];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const parseTransform = (value: string | undefined): Slot | null => {
  if (typeof value !== 'string') return null;
  const rotate = value.match(/rotate\(\s*(-?[\d.]+)deg\s*\)/);
  const translate = value.match(/translate\(\s*(-?[\d.]+)px(?:\s*,\s*(-?[\d.]+)px)?\s*\)/);
  return {
    x: translate ? Number(translate[1]) : 0,
    y: translate && translate[2] ? Number(translate[2]) : 0,
    rotate: rotate ? Number(rotate[1]) : 0
  };
};

const toCard = (item: BounceCardImage) =>
  typeof item === 'string' ? { src: item, alt: '', node: null } : { src: item?.src, alt: item?.alt ?? '', node: item?.node ?? null };

export default function BounceCards({
  images = [],
  className = '',
  style,
  containerWidth = 400,
  containerHeight = 400,
  cardSize = 200,
  spread = 85,
  rotation = 10,
  arc = 0,
  animationDelay = 0.5,
  animationStagger = 0.06,
  bounciness = 0.6,
  enableHover = true,
  pushDistance = 160,
  hoverScale = 1.06,
  borderWidth = 5,
  borderColor = '#ffffff',
  radius = 25,
  shadow = true,
  transformStyles,
  onCardClick,
  cardAspect = 1,
  fluid = false
}: BounceCardsProps) {
  const [fit, setFit] = React.useState(1);
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const wakeRef = useRef<(() => void) | null>(null);
  const cards = images.map(toCard);
  const count = cards.length;
  const middle = (count - 1) / 2;
  const reach = Math.max(1, middle);
  const slots = cards.map((_, i): Slot => {
    const custom = transformStyles ? parseTransform(transformStyles[i]) : null;
    if (custom) return custom;
    const offset = i - middle;
    return {
      x: offset * spread,
      y: arc * (offset / reach) ** 2,
      rotate: rotation * PATTERN[i % PATTERN.length]!
    };
  });
  const settings = {
    slots,
    cardSize: Math.max(10, cardSize),
    delay: Math.max(0, animationDelay),
    stagger: Math.max(0, animationStagger),
    bounciness: clamp(bounciness, 0, 1),
    enableHover,
    pushDistance,
    hoverScale: clamp(hoverScale, 0.5, 2),
    clickable: typeof onCardClick === 'function'
  };
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const clickRef = useRef(onCardClick);
  clickRef.current = onCardClick;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    // Already on screen at mount (or reduced motion): no entrance, so a
    // server-rendered fan never blinks out.
    const reduce =
      (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false) ||
      root.getBoundingClientRect().top < window.innerHeight;
    const bodies: Body[] = [];
    const state = { hovered: -1, time: 0, layer: -1 };
    let raf = 0;
    let last = performance.now();
    let alive = true;

    const body = (i: number): Body => {
      if (!bodies[i]) {
        const slot = settingsRef.current.slots[i] ?? { x: 0, y: 0, rotate: 0 };
        if (!reduce) cardRefs.current[i]?.style.setProperty('transform', 'translate(-50%, -50%) scale(0)');
        bodies[i] = {
          x: slot.x,
          y: slot.y,
          rotate: slot.rotate,
          scale: reduce ? 1 : 0,
          vx: 0,
          vy: 0,
          vr: 0,
          vs: 0,
          born: state.time
        };
      }
      return bodies[i];
    };

    const step = (
      value: number,
      velocity: number,
      target: number,
      stiffness: number,
      damping: number,
      dt: number
    ): [number, number] => {
      const next = velocity + ((target - value) * stiffness - velocity * damping) * dt;
      return [value + next * dt, next];
    };

    const frame = (now: number) => {
      raf = 0;
      if (!alive) return;
      const s = settingsRef.current;
      const dt = Math.min(1 / 30, Math.max(1 / 240, (now - last) / 1000));
      last = now;
      state.time += dt;

      const hovered = s.enableHover ? state.hovered : -1;
      const popStiffness = 170;
      const popDamping = 2 * (1 - 0.85 * s.bounciness) * Math.sqrt(popStiffness);
      const moveStiffness = 210;
      const moveDamping = 2 * (reduce ? 1 : 0.72) * Math.sqrt(moveStiffness);
      const substeps = Math.ceil(dt / (1 / 240));
      const h = dt / substeps;
      let moving = 0;

      for (let i = 0; i < s.slots.length; i++) {
        const el = cardRefs.current[i];
        if (!el) continue;
        const card = body(i);
        const slot = s.slots[i]!;
        const appeared = reduce || state.time - card.born >= s.delay + i * s.stagger;
        let targetX = slot.x;
        let targetY = slot.y;
        let targetRotate = slot.rotate;
        let targetScale = appeared ? 1 : 0;
        if (hovered >= 0 && appeared) {
          if (i === hovered) {
            targetY = slot.y - s.cardSize * 0.04;
            targetRotate = 0;
            targetScale = s.hoverScale;
          } else {
            targetX = slot.x + Math.sign(i - hovered) * s.pushDistance;
          }
        }
        for (let k = 0; k < substeps; k++) {
          [card.x, card.vx] = step(card.x, card.vx, targetX, moveStiffness, moveDamping, h);
          [card.y, card.vy] = step(card.y, card.vy, targetY, moveStiffness, moveDamping, h);
          [card.rotate, card.vr] = step(card.rotate, card.vr, targetRotate, moveStiffness, moveDamping, h);
          if (reduce) {
            card.scale = targetScale;
            card.vs = 0;
          } else {
            [card.scale, card.vs] = step(card.scale, card.vs, targetScale, popStiffness, popDamping, h);
          }
        }
        moving +=
          Math.abs(card.vx) +
          Math.abs(card.vy) +
          Math.abs(card.vr) +
          Math.abs(card.vs) * 100 +
          Math.abs(targetX - card.x) +
          Math.abs(targetY - card.y) +
          Math.abs(targetRotate - card.rotate) +
          Math.abs(targetScale - card.scale) * 100 +
          (appeared ? 0 : 1);
        el.style.transform = `translate(-50%, -50%) translate3d(${card.x.toFixed(2)}px, ${card.y.toFixed(2)}px, 0) rotate(${card.rotate.toFixed(3)}deg) scale(${Math.max(0, card.scale).toFixed(4)})`;
      }

      if (state.layer !== hovered) {
        state.layer = hovered;
        cardRefs.current.forEach((el, i) => {
          if (!el) return;
          el.style.zIndex = i === hovered ? String(s.slots.length + 1) : String(i + 1);
          el.toggleAttribute('data-active', i === hovered);
        });
      }

      if (moving > 0.02) raf = requestAnimationFrame(frame);
    };

    const wake = () => {
      if (raf || !alive) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    wakeRef.current = wake;

    const pick = (event: MouseEvent): number => {
      const s = settingsRef.current;
      const rect = root.getBoundingClientRect();
      // The fan may be zoomed to fit (fluid): map the pointer back to slot units.
      const k = rect.width / (root.offsetWidth || rect.width) || 1;
      const px = (event.clientX - rect.left - rect.width / 2) / k;
      const py = (event.clientY - rect.top - rect.height / 2) / k;
      let best = -1;
      let distance = Infinity;
      s.slots.forEach((slot, i) => {
        const gap = Math.abs(px - slot.x);
        if (gap < distance) {
          distance = gap;
          best = i;
        }
      });
      if (best < 0) return -1;
      const slot = s.slots[best]!;
      const half = s.cardSize / 2;
      if (Math.abs(py - slot.y) > half + 12 || distance > half + 12) return -1;
      if (state.hovered >= 0 && state.hovered !== best) {
        const current = s.slots[state.hovered];
        if (current && Math.abs(px - current.x) - distance < 6) return state.hovered;
      }
      return best;
    };

    const onMove = (event: PointerEvent) => {
      const next = pick(event);
      if (next !== state.hovered) {
        state.hovered = next;
        wake();
      }
    };
    const onLeave = () => {
      if (state.hovered !== -1) {
        state.hovered = -1;
        wake();
      }
    };
    const onClick = (event: MouseEvent) => {
      const index = pick(event);
      if (index < 0) return;
      const card = bodies[index];
      if (card && !reduce) card.vs -= 2.2;
      wake();
      clickRef.current?.(index);
    };
    const onFocus = (event: FocusEvent) => {
      const index = cardRefs.current.indexOf(event.target as HTMLDivElement);
      if (index >= 0) {
        state.hovered = index;
        wake();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const index = cardRefs.current.indexOf(event.target as HTMLDivElement);
      if (index < 0 || !settingsRef.current.clickable) return;
      event.preventDefault();
      if (bodies[index] && !reduce) bodies[index].vs -= 2.2;
      wake();
      clickRef.current?.(index);
    };

    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerdown', onMove);
    root.addEventListener('pointerleave', onLeave);
    root.addEventListener('click', onClick);
    root.addEventListener('focusin', onFocus);
    root.addEventListener('focusout', onLeave);
    root.addEventListener('keydown', onKey);
    wake();

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      wakeRef.current = null;
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerdown', onMove);
      root.removeEventListener('pointerleave', onLeave);
      root.removeEventListener('click', onClick);
      root.removeEventListener('focusin', onFocus);
      root.removeEventListener('focusout', onLeave);
      root.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    wakeRef.current?.();
  });

  useEffect(() => {
    if (!fluid) return undefined;
    const parent = rootRef.current?.parentElement;
    if (!parent) return undefined;
    const ro = new ResizeObserver(() => setFit(Math.min(1, parent.clientWidth / containerWidth)));
    ro.observe(parent);
    return () => ro.disconnect();
  }, [fluid, containerWidth]);

  return (
    <div
      ref={rootRef}
      className={`${ROOT}${className ? ` ${className}` : ''}`}
      style={
        {
          width: containerWidth,
          height: containerHeight,
          ...(fluid ? { zoom: fit } : null),
          '--bounce-cards-aspect': String(cardAspect),
          '--bounce-cards-size': `${settings.cardSize}px`,
          '--bounce-cards-border': `${Math.max(0, borderWidth)}px`,
          '--bounce-cards-border-color': borderColor,
          '--bounce-cards-radius': `${Math.max(0, radius)}px`,
          '--bounce-cards-shadow': shadow
            ? '0 1px 2px rgba(0, 0, 0, 0.12), 0 10px 28px -6px rgba(0, 0, 0, 0.32)'
            : 'none',
          '--bounce-cards-shadow-active': shadow
            ? '0 2px 4px rgba(0, 0, 0, 0.14), 0 22px 44px -10px rgba(0, 0, 0, 0.42)'
            : 'none',
          ...style
        } as React.CSSProperties
      }
    >
      {cards.map((card, i) => (
        <div
          key={i}
          ref={el => {
            cardRefs.current[i] = el;
          }}
          className={settings.clickable ? `${CARD} ${CLICKABLE}` : CARD}
          style={{ zIndex: i + 1, transform: `translate(-50%, -50%) translate3d(${slots[i]!.x}px, ${slots[i]!.y}px, 0) rotate(${slots[i]!.rotate}deg)` }}
          {...(settings.clickable ? { role: 'button', tabIndex: 0, 'aria-label': card.alt || `Card ${i + 1}` } : null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- upstream URL mode; QR Starr passes <picture> nodes */}
          {card.node ?? (card.src && <img className={IMG} src={card.src} alt={card.alt} draggable={false} />)}
        </div>
      ))}
    </div>
  );
}
