import "server-only";
import { cache } from "react";
import { getTranslations } from "next-intl/server";
import QRCode from "qrcode";
import { Inline } from "../inline";
import { getSiteContext, type SiteContext } from "../context";

/**
 * The home page's copy (messages/site/<locale>.json → "landing") and the
 * page context it resolves against. Strings are read raw and rendered with
 * the site's inline syntax, so product facts ({{fact.*}}) and the price
 * ({{price}}) come from the same constants and pricing data the product
 * enforces, never from the copy.
 */
export type Landing = {
  ctx: SiteContext;
  /** Plain string at `key` (no inline syntax). */
  text: (key: string) => string;
  /** String at `key`, rendered with tokens and inline markup. */
  rich: (key: string) => React.ReactNode;
  /** Array or object at `key`. */
  raw: <T>(key: string) => T;
};

export const getLanding = cache(async (): Promise<Landing> => {
  const [t, ctx] = await Promise.all([getTranslations("landing"), getSiteContext({ withPrice: true })]);
  const raw = <T,>(key: string) => t.raw(key) as T;
  return {
    ctx,
    raw,
    text: (key) => raw<string>(key),
    rich: (key) => <Inline text={raw<string>(key)} ctx={ctx} />,
  };
});

/**
 * The QR code printed on the illustrated cards. A real, scannable code for
 * the site's own address (never a greeting token), so a curious scan of the
 * illustration lands back on this page.
 */
export const HOME_QR_URL = "https://qrapp.ge";

export const getHomeQrSvg = cache(async () =>
  QRCode.toString(HOME_QR_URL, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#2a201cff", light: "#00000000" } }),
);
