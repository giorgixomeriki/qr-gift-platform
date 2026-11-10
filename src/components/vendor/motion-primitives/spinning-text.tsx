'use client';
/*
 * SpinningText — from Motion Primitives (https://motion-primitives.com,
 * github.com/ibelick/motion-primitives), components/core/spinning-text.tsx
 * @ e3c7b9967f5a3f59e993a760af463a454d215e16. Licence: MIT (Copyright (c) Julien Thibeaut).
 *
 * Adapted for QR Starr: the shadcn `cn` helper replaced by a plain join, and
 * reduced motion honoured (useReducedMotion: the ring rests, unrotated); `ease`
 * typed `as const` for this project's stricter TypeScript.
 */
import { motion, useReducedMotion, type Transition, type Variants } from 'motion/react';
import React, { CSSProperties } from 'react';

export type SpinningTextProps = {
  children: string;
  style?: CSSProperties;
  duration?: number;
  className?: string;
  reverse?: boolean;
  fontSize?: number;
  radius?: number;
  transition?: Transition;
  variants?: {
    container?: Variants;
    item?: Variants;
  };
};

const BASE_TRANSITION = {
  repeat: Infinity,
  ease: 'linear' as const,
};

const BASE_ITEM_VARIANTS = {
  hidden: {
    opacity: 1,
  },
  visible: {
    opacity: 1,
  },
};

export function SpinningText({
  children,
  duration = 10,
  style,
  className,
  reverse = false,
  fontSize = 1,
  radius = 5,
  transition,
  variants,
}: SpinningTextProps) {
  const reduce = useReducedMotion();
  const letters = children.split('');
  const totalLetters = letters.length;

  const finalTransition = {
    ...BASE_TRANSITION,
    ...transition,
    duration: (transition as { duration?: number })?.duration ?? duration,
  };

  const containerVariants = {
    visible: { rotate: reverse ? -360 : 360 },
    ...variants?.container,
  };

  const itemVariants = {
    ...BASE_ITEM_VARIANTS,
    ...variants?.item,
  };

  return (
    <motion.div
      className={['relative', className].filter(Boolean).join(' ')}
      style={{
        ...style,
      }}
      initial='hidden'
      animate={reduce ? 'hidden' : 'visible'}
      variants={containerVariants}
      transition={finalTransition}
    >
      {letters.map((letter, index) => (
        <motion.span
          aria-hidden='true'
          key={`${index}-${letter}`}
          variants={itemVariants}
          className='absolute left-1/2 top-1/2 inline-block'
          style={
            {
              '--index': index,
              '--total': totalLetters,
              '--font-size': fontSize,
              '--radius': radius,
              fontSize: `calc(var(--font-size, 2) * 1rem)`,
              transform: `
                  translate(-50%, -50%)
                  rotate(calc(360deg / var(--total) * var(--index)))
                  translateY(calc(var(--radius, 5) * -1ch))
                `,
              transformOrigin: 'center',
            } as React.CSSProperties
          }
        >
          {letter}
        </motion.span>
      ))}
      <span className='sr-only'>{children}</span>
    </motion.div>
  );
}
