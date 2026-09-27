import "server-only";

import { buildSalesForecast, type SalesForecastOptions, type SalesForecastResult } from "@/lib/forecasting/sales-forecast";
import { prisma } from "@/lib/prisma";
import { requireOrganizationUser } from "@/lib/server/organization-context";

/**
 * Sales forecast (J+1 up to 7 days) for the CONNECTED user's organisation only
 * - the organisation always comes from the session. Not connected to the AI
 * Assistant yet (step 2 only validates the prediction engine).
 */
export async function getSalesForecast(options: SalesForecastOptions = {}): Promise<SalesForecastResult> {
  const user = await requireOrganizationUser(["admin", "depot_manager"]);
  return buildSalesForecast(prisma, user.organizationId, options);
}
