'use client';

/*
 * ImageComparison — Motion Primitives
 * (https://motion-primitives.com/docs/image-comparison), registry file
 * c/image-comparison.json, fetched 2026-10-22. Licence: MIT
 * (https://github.com/ibelick/motion-primitives).
 *
 * QR Starr changes: layers take any children (a <picture> or live HTML),
 * not only an <img src>; the handle is a keyboard-operable slider
 * (role="slider", arrows/Home/End/PageUp/PageDown, aria-valuenow) and
 * pointer events replace the separate mouse/touch handlers, so a drag works
 * with any pointer and never sticks; the starting position is a prop.
 */
import { cn } from '@/lib/cn';
import { useState, createContext, useContext, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { motion, MotionValue, SpringOptions, useMotionValue, useSpring, useTransform } from 'motion/react';

const ImageComparisonContext = createContext<
  | {
      sliderPosition: number;
      setPosition: (pos: number) => void;
      motionSliderPosition: MotionValue<number>;
    }
  | undefined
>(undefined);

export type ImageComparisonProps = {
  children: ReactNode;
  className?: string;
  enableHover?: boolean;
  springOptions?: SpringOptions;
  initial?: number;
};

const DEFAULT_SPRING_OPTIONS = {
  bounce: 0,
  duration: 0,
};

function ImageComparison({ children, className, enableHover, springOptions, initial = 50 }: ImageComparisonProps) {
  const [isDragging, setIsDragging] = useState(false);
  const motionValue = useMotionValue(initial);
  const motionSliderPosition = useSpring(motionValue, springOptions ?? DEFAULT_SPRING_OPTIONS);
  const [sliderPosition, setSliderPosition] = useState(initial);
  const ref = useRef<HTMLDivElement>(null);

  const setPosition = (pos: number) => {
    const p = Math.min(Math.max(pos, 0), 100);
    motionValue.set(p);
    setSliderPosition(p);
  };

  const fromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setPosition(((event.clientX - rect.left) / rect.width) * 100);
  };

  return (
    <ImageComparisonContext.Provider value={{ sliderPosition, setPosition, motionSliderPosition }}>
      <div
        ref={ref}
        className={cn('relative select-none overflow-hidden touch-pan-y', enableHover && 'cursor-ew-resize', className)}
        onPointerMove={(e) => (isDragging || enableHover) && fromPointer(e)}
        onPointerDown={(e) => {
          if (enableHover) return;
          setIsDragging(true);
          e.currentTarget.setPointerCapture(e.pointerId);
          fromPointer(e);
        }}
        onPointerUp={() => setIsDragging(false)}
        onPointerCancel={() => setIsDragging(false)}
      >
        {children}
      </div>
    </ImageComparisonContext.Provider>
  );
}

const ImageComparisonImage = ({ className, children, position }: { className?: string; children: ReactNode; position: 'left' | 'right' }) => {
  const { motionSliderPosition } = useContext(ImageComparisonContext)!;
  const leftClipPath = useTransform(motionSliderPosition, (value) => `inset(0 0 0 ${value}%)`);
  const rightClipPath = useTransform(motionSliderPosition, (value) => `inset(0 ${100 - value}% 0 0)`);

  return (
    <motion.div
      className={cn('absolute inset-0 h-full w-full', className)}
      style={{
        clipPath: position === 'left' ? leftClipPath : rightClipPath,
      }}
    >
      {children}
    </motion.div>
  );
};

const ImageComparisonSlider = ({ className, children, label, valueText }: { className: string; children?: ReactNode; label: string; valueText?: (value: number) => string }) => {
  const { motionSliderPosition, sliderPosition, setPosition } = useContext(ImageComparisonContext)!;

  const left = useTransform(motionSliderPosition, (value) => `${value}%`);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'PageUp' || e.key === 'PageDown' ? 25 : 5;
    const map: Record<string, number> = { ArrowLeft: sliderPosition - step, ArrowDown: sliderPosition - step, PageDown: sliderPosition - step, ArrowRight: sliderPosition + step, ArrowUp: sliderPosition + step, PageUp: sliderPosition + step, Home: 0, End: 100 };
    if (!(e.key in map)) return;
    e.preventDefault();
    setPosition(map[e.key]!);
  };

  return (
    <motion.div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(sliderPosition)}
      aria-valuetext={valueText?.(Math.round(sliderPosition))}
      onKeyDown={onKeyDown}
      className={cn('absolute bottom-0 top-0 w-1 cursor-ew-resize', className)}
      style={{
        left,
      }}
    >
      {children}
    </motion.div>
  );
};

export { ImageComparison, ImageComparisonImage, ImageComparisonSlider };
