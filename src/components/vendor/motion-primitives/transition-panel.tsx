'use client';

/*
 * TransitionPanel — Motion Primitives
 * (https://motion-primitives.com/docs/transition-panel), registry file
 * c/transition-panel.json, fetched 2026-10-22. Licence: MIT
 * (https://github.com/ibelick/motion-primitives).
 * QR Starr changes: none to behaviour; `cn` comes from lib/cn.
 */
import { AnimatePresence, Transition, Variant, motion, MotionProps } from 'motion/react';
import { cn } from '@/lib/cn';

export type TransitionPanelProps = {
  children: React.ReactNode[];
  className?: string;
  transition?: Transition;
  activeIndex: number;
  variants?: { enter: Variant; center: Variant; exit: Variant };
} & MotionProps;

export function TransitionPanel({ children, className, transition, variants, activeIndex, ...motionProps }: TransitionPanelProps) {
  return (
    <div className={cn('relative', className)}>
      <AnimatePresence initial={false} mode='popLayout' custom={motionProps.custom}>
        <motion.div key={activeIndex} variants={variants} transition={transition} initial='enter' animate='center' exit='exit' {...motionProps}>
          {children[activeIndex]}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
