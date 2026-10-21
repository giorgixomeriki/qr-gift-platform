import "server-only";
import { cache } from "react";
import { parseMerchantInfo, type MerchantInfo } from "./info";

/**
 * The deployment's merchant details (MERCHANT_* / LEGAL_EFFECTIVE_DATE),
 * parsed once per request. Server-only: the values are public once
 * published, but reading process.env belongs on the server.
 */
export const getMerchantInfo = cache((): MerchantInfo => parseMerchantInfo(process.env));
