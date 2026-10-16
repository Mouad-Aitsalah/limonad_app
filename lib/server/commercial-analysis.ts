import "server-only";

import { COMMERCIAL_ANALYSIS_VIEW_ROLES } from "@/lib/commercial-analysis/access";
import { prisma } from "@/lib/prisma";
import { loadCoverage, loadSalesAnalysis } from "@/lib/server/commercial-analysis-core";
import { requireDashboardAccess } from "@/lib/server/dashboard-security";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import type { CoverageDto, CoverageFilters, SalesAnalysisDto, SalesAnalysisFilters } from "@/types/commercial-analysis";

/**
 * Commercial analysis of the Dashboard - the ENTRY POINTS.
 *
 * ADMIN ONLY, enforced here (requireOrganizationUser(["admin"])) - the page only
 * decides what to render. The organisation comes from the session, never from the
 * request; the calculations (and their rules) live in commercial-analysis-core.ts.
 */

export const COMMERCIAL_ANALYSIS_ROLES = COMMERCIAL_ANALYSIS_VIEW_ROLES;

export async function getSalesAnalysis(filters: SalesAnalysisFilters): Promise<SalesAnalysisDto> {
  const user = await requireOrganizationUser([...COMMERCIAL_ANALYSIS_ROLES]);
  await requireDashboardAccess(user);
  return loadSalesAnalysis(prisma, user.organizationId, filters);
}

export async function getCoverage(filters: CoverageFilters): Promise<CoverageDto> {
  const user = await requireOrganizationUser([...COMMERCIAL_ANALYSIS_ROLES]);
  await requireDashboardAccess(user);
  return loadCoverage(prisma, user.organizationId, filters);
}
