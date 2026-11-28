import { isHostedEnvironment } from "@/lib/env-guards";

/**
 * Test fixtures (partner_locations.is_mock) are shown only when
 * PARTNER_MAP_MOCKS=1 on a machine that is not a hosted deployment. On
 * Vercel/Render/APP_HOSTED the flag is ignored here AND refused at boot
 * (lib/env.ts), so a mock row can never reach the public site even if one
 * were inserted into a production database by mistake.
 */
export function partnerMapMocksEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.PARTNER_MAP_MOCKS === "1" && !isHostedEnvironment(env);
}
