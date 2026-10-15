import { createPublicKey, verify, type KeyObject } from "node:crypto";

export const BOG_SIGNATURE_HEADER = "callback-signature";

/**
 * Parses BOG's callback public key (PEM). Throws on anything that is not an
 * RSA public key, so a misconfigured key fails at startup, not at the first
 * callback.
 */
export function parseBogPublicKey(pem: string): KeyObject {
  const key = createPublicKey({ key: pem.replace(/\\n/g, "\n"), format: "pem" });
  if (key.asymmetricKeyType !== "rsa") throw new Error("BOG callback key must be an RSA public key");
  return key;
}

/**
 * Callback-Signature: SHA256withRSA over the exact request body, verified
 * BEFORE the body is parsed (BOG's own guidance: re-serialising JSON can
 * change the bytes). The header is treated as required even though BOG's docs
 * mark it optional: an unsigned callback is rejected.
 *
 * Encoding assumption: base64. To be confirmed by BOG with a signed sample
 * (docs/integration/BOG_MERCHANT_REQUIREMENTS.md B6).
 */
export function verifyBogSignature(rawBody: string, signature: string | null, publicKey: KeyObject): boolean {
  if (!signature || !/^[A-Za-z0-9+/=_-]+$/.test(signature.trim())) return false;
  const sig = Buffer.from(signature.trim(), "base64");
  if (sig.length === 0) return false;
  try {
    return verify("sha256", Buffer.from(rawBody, "utf8"), publicKey, sig);
  } catch {
    return false;
  }
}
