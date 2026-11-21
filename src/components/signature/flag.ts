import "server-only";

/**
 * Rollback switch for the Signature Experience sender screens (integration
 * blueprint §11). On by default; SIGNATURE_UI=0 restores the legacy wizard
 * and homepage without a deploy of old code. Server-side only: the choice is
 * made per request in the page, never in the browser. Removed after release.
 */
export function signatureUiEnabled(): boolean {
  return process.env.SIGNATURE_UI !== "0";
}
