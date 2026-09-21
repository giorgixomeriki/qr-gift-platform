import "server-only";
import QRCode from "qrcode";
import { publicEnv } from "@/lib/env.public";

/**
 * The physical QR URL (Phase 1). This is the ONLY thing ever encoded into the
 * QR image — never an internal id, partner id, greeting id, edit token, or
 * payment data. Printed on the card, scanned by anyone, resolved with zero
 * actor context by lib/qr/resolve-state.ts.
 */
export function publicQrUrl(publicToken: string): string {
  return `${publicEnv.NEXT_PUBLIC_APP_URL}/g/${publicToken}`;
}

/**
 * Generated deterministically on demand from the public token — never stored
 * as a blob. Same token always produces the same image, so there is nothing
 * to keep in sync and nothing to regenerate if the app URL is identical.
 * SVG is preferred for print (vector, scales losslessly to any card size).
 */
/**
 * Reliability settings for a card that will be printed small, handled,
 * creased, and scanned under imperfect lighting (Phase 5 §14 "QR reliability
 * first"): "Q" (25% error-correction) trades a slightly denser pattern for
 * real damage/glare tolerance over the previous "M" (15%), and a margin of 4
 * modules is the QR spec's own minimum quiet zone — 2 was thinner than
 * recommended and risked misreads right at the card's edge.
 */
const RELIABLE_QR_OPTIONS = { errorCorrectionLevel: "Q", margin: 4 } as const;

export async function generateQrSvg(publicToken: string): Promise<string> {
  return QRCode.toString(publicQrUrl(publicToken), {
    type: "svg",
    ...RELIABLE_QR_OPTIONS,
  });
}

export async function generateQrPng(publicToken: string): Promise<Buffer> {
  return QRCode.toBuffer(publicQrUrl(publicToken), {
    type: "png",
    ...RELIABLE_QR_OPTIONS,
    width: 512,
  });
}
