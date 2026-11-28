/*
 * Marquee — Magic UI (https://magicui.design/docs/components/marquee),
 * registry file r/marquee.json, fetched 2026-10-21. Licence: MIT,
 * Copyright (c) Magic UI.
 *
 * QR Starr changes: the keyframes and the reduced-motion stop live in
 * home.css (.hm-marquee); only the first copy of the content is exposed to
 * assistive tech (the repeats are aria-hidden), so a screen reader hears
 * each item once.
 */
import { type ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/cn";

interface MarqueeProps extends ComponentPropsWithoutRef<"div"> {
  reverse?: boolean;
  pauseOnHover?: boolean;
  children: React.ReactNode;
  repeat?: number;
}

export function Marquee({ className, reverse = false, pauseOnHover = false, children, repeat = 2, ...props }: MarqueeProps) {
  return (
    <div {...props} className={cn("hm-marquee group", className)}>
      {Array.from({ length: repeat }, (_, i) => (
        <div
          key={i}
          aria-hidden={i > 0 || undefined}
          className={cn("hm-marquee__track", { "hm-marquee__track--reverse": reverse, "hm-marquee__track--pause": pauseOnHover })}
        >
          {children}
        </div>
      ))}
    </div>
  );
}
