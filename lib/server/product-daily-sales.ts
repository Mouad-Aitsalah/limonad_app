import "server-only";

import {
  buildProductDailySalesDataset,
  getProductDailySalesCoverage,
  type ProductDailySalesCoverage,
  type ProductDailySalesOptions,
} from "@/lib/forecasting/product-daily-sales";
import type { ProductDailySalesRow } from "@/lib/forecasting/daily-sales-series";
import { prisma } from "@/lib/prisma";
import { requireOrganizationUser } from "@/lib/server/organization-context";

/**
 * Historical demand per Produit x Jour for the CONNECTED user's organisation
 * (never another one: the organisation always comes from the session). Reusable
 * by the future ML model, the AI Assistant and the forecast / purchase pages.
 * See lib/forecasting/product-daily-sales.ts for the rules.
 */
export async function getProductDailySalesDataset(
  options: ProductDailySalesOptions = {},
): Promise<ProductDailySalesRow[]> {
  const user = await requireOrganizationUser(["admin", "depot_manager"]);
  return buildProductDailySalesDataset(prisma, user.organizationId, options);
}

export async function getProductDailySalesDatasetCoverage(): Promise<ProductDailySalesCoverage> {
  const user = await requireOrganizationUser(["admin", "depot_manager"]);
  return getProductDailySalesCoverage(prisma, user.organizationId);
}
