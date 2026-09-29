/**
 * When may a QR card's credential (its public token, /g/ URL, or QR image)
 * be released to someone operating the card inventory? QA-01 V1 hardening —
 * see docs/PRIVACY_MODEL.md.
 *
 * The printed token is the ONLY key to the greeting behind it. Partners need
 * it to print cards, but only while a card is still unclaimed: from the
 * moment a sender starts a greeting (AVAILABLE -> DRAFT) there is content
 * behind it and no partner operation needs the credential any more. So:
 *   - ADMIN:   always (support/reprints; admins can read greetings anyway)
 *   - PARTNER: only while the card is AVAILABLE
 * and partners see a claimed card's lifecycle only as "USED" — never whether
 * a greeting is being written, live, or blocked.
 *
 * This limits what the PLATFORM hands out. It cannot un-know a token a
 * partner copied while the card was still available (see PRIVACY_MODEL.md).
 *
 * Pure functions (no server-only import) so the inventory table's row type
 * can be shared with its client component.
 */

export type CredentialViewer = "ADMIN" | "PARTNER";

/** What a partner is told about a card: unclaimed, or used — nothing finer. */
export type PartnerQrStatus = "AVAILABLE" | "USED";
export type InventoryQrStatus = PartnerQrStatus | "DRAFT" | "ACTIVE" | "BLOCKED";

export type InventoryQrRow = {
  id: string;
  /** The full public token when released to this viewer, otherwise a masked suffix. */
  label: string;
  credentialReleased: boolean;
  status: InventoryQrStatus;
  distributionStatus: string;
};

export function isCredentialReleasable(viewer: CredentialViewer, qrStatus: string): boolean {
  return viewer === "ADMIN" || qrStatus === "AVAILABLE";
}

/** Enough to tell cards apart on screen, never enough to open one (~20 of ~120 bits). */
export function maskPublicToken(publicToken: string): string {
  return `••••${publicToken.slice(-4)}`;
}

export function statusForViewer(viewer: CredentialViewer, qrStatus: string): InventoryQrStatus {
  if (viewer === "ADMIN") return qrStatus as InventoryQrStatus;
  return qrStatus === "AVAILABLE" ? "AVAILABLE" : "USED";
}

/** The only shape QR rows leave the server in for the inventory UI — no raw row, no timestamps, no token unless releasable. */
export function toInventoryRow(
  qr: { id: string; publicToken: string; status: string; distributionStatus: string },
  viewer: CredentialViewer,
): InventoryQrRow {
  const credentialReleased = isCredentialReleasable(viewer, qr.status);
  return {
    id: qr.id,
    label: credentialReleased ? qr.publicToken : maskPublicToken(qr.publicToken),
    credentialReleased,
    status: statusForViewer(viewer, qr.status),
    distributionStatus: qr.distributionStatus,
  };
}
