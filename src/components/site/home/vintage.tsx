"use client";

import type { ReactNode } from "react";
import { ContainerScroll } from "@/components/vendor/aceternity/container-scroll";
import { ImageComparison, ImageComparisonImage, ImageComparisonSlider } from "@/components/vendor/motion-primitives/image-comparison";
import {
  MorphingDialog,
  MorphingDialogClose,
  MorphingDialogContainer,
  MorphingDialogContent,
  MorphingDialogDescription,
  MorphingDialogTitle,
  MorphingDialogTrigger,
} from "@/components/vendor/motion-primitives/morphing-dialog";
import BounceCards from "@/components/vendor/reactbits/bounce-cards";

/*
 * The luxury-vintage layer's interactive pieces, built from the vendored
 * components (components/vendor). Server components pass in the pictures
 * and the words; nothing here fetches or decides content.
 */

/**
 * From paper to screen: Aceternity's container rises flat as the section
 * scrolls in, and inside it Motion Primitives' comparison slider wipes from
 * the sealed card on a desk to the greeting it opens.
 */
export function PaperToScreen({ paper, screen, labels }: { paper: ReactNode; screen: ReactNode; labels: { paper: string; screen: string; slider: string; value: string } }) {
  return (
    <ContainerScroll>
      <ImageComparison className="hm-compare" springOptions={{ bounce: 0, duration: 0.25 }} initial={46}>
        <ImageComparisonImage position="right">{paper}</ImageComparisonImage>
        <ImageComparisonImage position="left">{screen}</ImageComparisonImage>
        <span className="hm-compare__tag hm-compare__tag--paper" aria-hidden>
          {labels.paper}
        </span>
        <span className="hm-compare__tag hm-compare__tag--screen" aria-hidden>
          {labels.screen}
        </span>
        <ImageComparisonSlider className="hm-compare__rule" label={labels.slider} valueText={(v) => labels.value.replace("{value}", String(v))}>
          <span className="hm-compare__handle" aria-hidden>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 6l-6 6 6 6M15 6l6 6-6 6" />
            </svg>
          </span>
        </ImageComparisonSlider>
      </ImageComparison>
    </ContainerScroll>
  );
}

/**
 * An occasion card that opens into its collectible postcard (Motion
 * Primitives MorphingDialog): the photograph on the front, a Redouté plate,
 * the design's own opening line and sample words on the back.
 */
export function OccasionPostcard({
  front,
  plate,
  swatch,
  label,
  title,
  text,
  designLabel,
  opening,
  sample,
  labels,
}: {
  front: ReactNode;
  plate: ReactNode;
  swatch: ReactNode;
  label: string;
  title: string;
  text: string;
  designLabel: string;
  opening: string;
  sample: string;
  labels: { open: string; close: string; postcard: string };
}) {
  return (
    <MorphingDialog transition={{ type: "spring", bounce: 0.05, duration: 0.45 }}>
      <MorphingDialogTrigger className="hm-occ" label={labels.open}>
        {front}
        <span className="hm-occ__design" aria-hidden>
          {swatch}
        </span>
        <span className="hm-occ__body">
          <span className="hm-occ__label">{label}</span>
          <span className="hm-occ__title">{title}</span>
          <span className="hm-occ__text">{text}</span>
        </span>
      </MorphingDialogTrigger>
      <MorphingDialogContainer>
        <MorphingDialogContent className="hm-postcard">
          <span className="hm-gilt hm-gilt--tl" aria-hidden />
          <div className="hm-postcard__plate">{plate}</div>
          <div className="hm-postcard__back">
            <p className="hm-postcard__kicker">{labels.postcard}</p>
            <MorphingDialogTitle className="hm-postcard__title">{title}</MorphingDialogTitle>
            <MorphingDialogDescription disableLayoutAnimation className="hm-postcard__desc" variants={{ initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 8 } }}>
              <p className="hm-postcard__opening">{opening}</p>
              <p className="hm-postcard__sample">{sample}</p>
              <p className="hm-postcard__design">{designLabel}</p>
            </MorphingDialogDescription>
          </div>
          <MorphingDialogClose label={labels.close} className="hm-postcard__close" />
        </MorphingDialogContent>
      </MorphingDialogContainer>
    </MorphingDialog>
  );
}

/** React Bits BounceCards: a fan of collectible postcards that part as you hover. */
export function PostcardFan({ cards, label }: { cards: { node: ReactNode; alt: string }[]; label: string }) {
  return (
    <div className="hm-fanwrap" role="img" aria-label={label}>
      <BounceCards
        images={cards}
        containerWidth={560}
        containerHeight={300}
        cardSize={168}
        cardAspect={4 / 5}
        spread={92}
        rotation={9}
        arc={14}
        pushDistance={70}
        borderWidth={7}
        borderColor="#fbf7f0"
        radius={4}
        animationDelay={0.15}
        fluid
        className="hm-fan"
      />
    </div>
  );
}
