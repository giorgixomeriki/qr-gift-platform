import "server-only";
import { cache } from "react";
import { loadMerchantInfo, type MerchantInfo } from "./info";
import { logServerError } from "@/lib/log";

/**
 * The deployment's merchant details (MERCHANT_* / LEGAL_EFFECTIVE_DATE, or
 * the fictional demo profile when MERCHANT_PROFILE=demo outside production),
 * resolved once per request. Server-only: the values are public once
 * published, but reading process.env belongs on the server.
 */
export const getMerchantInfo = cache((): MerchantInfo => {
  const info = loadMerchantInfo(process.env);
  if (info.profileRefused) logServerError("getMerchantInfo", new Error(info.profileRefused));
  return info;
});
