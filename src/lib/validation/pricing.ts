import { z } from "zod";
import { MAX_COMMISSION_BPS, MAX_PRICE_MINOR, MIN_PRICE_MINOR } from "@/lib/payments/split";

/**
 * Super Admin pricing inputs. Amounts are integer minor units (tetri) and
 * rates integer basis points — the admin form converts "12.50" / "30.5"
 * exactly (lib/payments/split.ts parseMajorToMinor / parsePercentToBps)
 * before sending, so no floating point ever reaches the server. Each input
 * also carries the value the admin last saw (expected*), which the service
 * compares under a row lock to refuse a stale overwrite.
 */
const priceMinor = z.number().int().min(MIN_PRICE_MINOR).max(MAX_PRICE_MINOR);
const expectedPriceMinor = z.number().int().nonnegative().nullable();
const commissionBps = z.number().int().min(0).max(MAX_COMMISSION_BPS);

export const setDefaultPriceSchema = z.object({
  amountMinor: priceMinor,
  expectedAmountMinor: expectedPriceMinor,
});

export const setPartnerPriceSchema = z.object({
  // null clears the override: the partner falls back to the platform default.
  amountMinor: priceMinor.nullable(),
  expectedAmountMinor: expectedPriceMinor,
});

export const setPartnerCommissionSchema = z.object({
  commissionRateBps: commissionBps,
  expectedCommissionRateBps: commissionBps,
});
