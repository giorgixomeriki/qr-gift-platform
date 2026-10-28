"use client"

/*
 * HeroVideoDialog — Magic UI (https://magicui.design/docs/components/hero-video-dialog),
 * registry file r/hero-video-dialog.json, fetched 2026-10-22. Licence: MIT,
 * Copyright (c) Magic UI.
 *
 * Kept: a poster that scales gently on hover with a central play disc, and
 * a dialog that springs open from the centre over a dimmed backdrop.
 * QR Starr changes:
 * - a native <video> with controls (the original embeds an <iframe>);
 *   playback starts only when the visitor opens it, and the clip is silent;
 * - the poster is any node (a responsive <picture>) plus a title and
 *   duration, instead of a single thumbnail URL;
 * - real dialog semantics: role="dialog", aria-modal, a labelled close
 *   button that takes focus, Escape to close, focus returned to the poster,
 *   and the page does not scroll behind it;
 * - Phosphor icons instead of lucide; colours come from home.css (.hm-vdlg).
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { AnimatePresence, motion } from "motion/react"
import { Play } from "@phosphor-icons/react/dist/csr/Play"
import { X } from "@phosphor-icons/react/dist/csr/X"

export function HeroVideoDialog({
  poster,
  videoSrc,
  posterSrc,
  title,
  duration,
  labels,
  className = "",
}: {
  poster: ReactNode
  videoSrc: string
  posterSrc: string
  title: string
  duration: string
  labels: { play: string; close: string }
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    const root = document.documentElement
    root.classList.add("hm-dialog-open")
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false)
    document.addEventListener("keydown", onKey)
    return () => {
      root.classList.remove("hm-dialog-open")
      document.removeEventListener("keydown", onKey)
      trigger?.focus()
    }
  }, [open])

  return (
    <div className={`hm-vdlg ${className}`}>
      <button ref={triggerRef} type="button" className="hm-vdlg__poster group" aria-label={`${labels.play}: ${title}`} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <span className="hm-vdlg__media">{poster}</span>
        <span className="hm-vdlg__shade" aria-hidden />
        <span className="hm-vdlg__title" aria-hidden>
          {title}
        </span>
        <span className="hm-vdlg__play" aria-hidden>
          <Play size={22} weight="fill" />
        </span>
        <span className="hm-vdlg__dur" aria-hidden>
          {duration}
        </span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="hm-vdlg__backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)}>
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              className="hm-vdlg__panel"
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
            >
              <p id={titleId} className="sr-only">
                {title}
              </p>
              <button ref={closeRef} type="button" className="hm-vdlg__close" aria-label={labels.close} onClick={() => setOpen(false)}>
                <X size={20} weight="bold" />
              </button>
              <video className="hm-vdlg__video" src={videoSrc} poster={posterSrc} controls autoPlay playsInline muted preload="metadata" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
