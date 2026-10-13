"use client";

import { useEffect } from "react";

/**
 * While a full-screen world is showing, the browser around it takes the
 * world's room colour: Android Chrome's toolbar (and Safari's, where it reads
 * `theme-color`) and the canvas behind the page — so iOS rubber-band
 * overscroll and the area under translucent browser chrome show the room, not
 * a strip of cream paper under a dark world. Restored on unmount.
 */
export function useChromeTint(color: string | null) {
  useEffect(() => {
    if (!color) return;
    const html = document.documentElement;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const prevMeta = meta?.content;
    const prevBg = html.style.backgroundColor;
    html.style.backgroundColor = color;
    if (meta) meta.content = color;
    return () => {
      html.style.backgroundColor = prevBg;
      if (meta && prevMeta !== undefined) meta.content = prevMeta;
    };
  }, [color]);
}
