"use client";

/**
 * The customer experience's icon vocabulary — Phosphor Icons, one family,
 * named by meaning rather than by glyph so every customer screen reaches for
 * the same icon for the same idea. Admin/partner screens stay on Lucide; the
 * two never mix on one screen.
 *
 * Weight: "regular" for ordinary UI (it sits well next to Google Sans at
 * text sizes); "fill"/"duotone" only for a meaningful state (e.g. a playing
 * voice note, a completed step). The Starr spark is a custom brand mark
 * (components/ui/logo.tsx) and is never replaced by a library icon.
 *
 * Per-icon imports (dist/csr/*) keep the bundle to the icons actually used.
 * These modules read React context, so this file is a client module; server
 * components can still render the icons with plain props.
 */
export { PenNib as TextIcon } from "@phosphor-icons/react/dist/csr/PenNib";
export { Image as PhotoIcon } from "@phosphor-icons/react/dist/csr/Image";
export { VideoCamera as VideoIcon } from "@phosphor-icons/react/dist/csr/VideoCamera";
export { Microphone as VoiceIcon } from "@phosphor-icons/react/dist/csr/Microphone";

export { Clock as TimeIcon } from "@phosphor-icons/react/dist/csr/Clock";
export { Tag as PriceIcon } from "@phosphor-icons/react/dist/csr/Tag";
export { Eye as PreviewIcon } from "@phosphor-icons/react/dist/csr/Eye";

export { ArrowLeft as BackIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
export { ArrowRight as ContinueIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
export { PencilSimple as EditIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";

export { UploadSimple as UploadIcon } from "@phosphor-icons/react/dist/csr/UploadSimple";
export { ArrowsClockwise as ReplaceIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
export { Trash as DeleteIcon } from "@phosphor-icons/react/dist/csr/Trash";
export { X as RemoveIcon } from "@phosphor-icons/react/dist/csr/X";

export { Play as PlayIcon } from "@phosphor-icons/react/dist/csr/Play";
export { Pause as PauseIcon } from "@phosphor-icons/react/dist/csr/Pause";
export { Record as RecordIcon } from "@phosphor-icons/react/dist/csr/Record";
export { Stop as StopIcon } from "@phosphor-icons/react/dist/csr/Stop";
export { ArrowCounterClockwise as ReplayIcon } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";

export { CheckCircle as SuccessIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
export { WarningCircle as ErrorIcon } from "@phosphor-icons/react/dist/csr/WarningCircle";
export { LockSimple as SecureIcon } from "@phosphor-icons/react/dist/csr/LockSimple";
