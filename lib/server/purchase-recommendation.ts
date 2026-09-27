import "server-only";

import {
  getPurchaseRecommendationsFor,
  type PurchaseRecommendationOptions,
  type PurchaseRecommendationResult,
} from "@/lib/forecasting/purchase-recommendation";
import { prisma } from "@/lib/prisma";
import { requireOrganizationUser } from "@/lib/server/organization-context";

/**
 * Purchase recommendations (7-day horizon) for the CONNECTED user's
 * organisation only. Same authorisation as the sales forecast (admin and
 * depot manager); the organisation always comes from the session, never an
 * argument. Not connected to any page yet; used by the AI Assistant tool
 * (lib/server/assistant-purchase-tool.ts).
 *
 * STEP 4 - "PRÉCALCUL / CACHE": all the cache-vs-fallback decision logic lives
 * in lib/forecasting/purchase-recommendation.ts's getPurchaseRecommendationsFor
 * (injectable, tested there directly) - this wrapper only supplies the real
 * `prisma` client and the session-derived organisation.
 */
export async function getPurchaseRecommendations(
  options: PurchaseRecommendationOptions = {},
): Promise<PurchaseRecommendationResult> {
  const user = await requireOrganizationUser(["admin", "depot_manager"]);
  return getPurchaseRecommendationsFor(prisma, user.organizationId, options);
}
