"use client";

import { WaxSeal } from "@/components/customer/wax-seal";
import { Spark } from "@/components/ui/logo";

/**
 * The Signature opening (integration blueprint §2.7): the greeting arrives
 * as a sealed stationery envelope lying in the chosen world's own room, in a
 * pool of warm light. When the seal gives and the flap folds back, a sheet of
 * letter paper addressed "for you" rises out — the same paper the closing
 * letter is written on — and the world's scene takes over from there (the
 * renderer's message beat).
 *
 * Pure CSS paper (reveal-signature.css). The sheet is clipped to the envelope
 * at the sides and bottom only, so it can rise out of the open top. Nothing
 * here waits on an image or a font file.
 *
 * Decorative: the renderer's labelled Open button is the accessible control;
 * the seal is a large pointer target duplicating it.
 */
export function RevealEnvelope({
  state,
  addressee,
  onOpen,
  locked = false,
  unlocking = false,
}: {
  state: "sealed" | "opening";
  /** The line on the sheet ("For you"). */
  addressee: string;
  onOpen: () => void;
  /** Scheduled Reveal: tied with a satin ribbon and not openable until its moment (scheduled-reveal.tsx). */
  locked?: boolean;
  /** The moment has come: the ribbon slips off. */
  unlocking?: boolean;
}) {
  const ribbon = locked || unlocking;
  return (
    <div className="sx-env" data-state={state} data-ribbon={ribbon ? (unlocking ? "off" : "on") : undefined} aria-hidden>
      <span className="sx-env__back" />
      <span className="sx-env__card">
        <span className="sx-env__sheet">
          <Spark className="sx-env__mark" />
          <span className="sx-env__to">{addressee}</span>
          <span className="sx-env__rule" />
          <span className="sx-env__rule" />
          <span className="sx-env__rule" />
        </span>
      </span>
      <span className="sx-env__pocket" />
      <span className="sx-env__flap" />
      {ribbon && (
        <span className="sx-env__ribbon">
          <span className="sx-env__ribbon-band" />
          <span className="sx-env__ribbon-band sx-env__ribbon-band--h" />
        </span>
      )}
      <button type="button" className="sx-env__seal" onClick={onOpen} disabled={state !== "sealed" || ribbon} tabIndex={-1} data-pressed={state === "opening" || undefined}>
        <WaxSeal className="sx-env__wax" />
      </button>
    </div>
  );
}
