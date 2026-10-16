import "server-only";

import { prisma } from "@/lib/prisma";
import { RECEIVABLES_VIEW_ROLES } from "@/lib/receivables/access";
import { validateOverdueDays } from "@/lib/receivables/settings";
import { resolveCustomerAuxiliaryCode } from "@/lib/server/accounting";
import { OperationsServiceError } from "@/lib/server/depots";
import { requireDashboardAccess } from "@/lib/server/dashboard-security";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import {
  loadCustomerReceivableDetail,
  loadReceivablesOverview,
  readReceivablesSettings,
  writeReceivablesSettings,
} from "@/lib/server/receivables-core";
import type { CustomerReceivableDetailDto, ReceivablesOverviewDto, ReceivablesSettings } from "@/types/receivables";

/**
 * Dashboard « Créances clients » - the ENTRY POINTS.
 *
 * ADMIN ONLY, enforced here (requireOrganizationUser(["admin"])) - the page only
 * decides what to render. The organisation is always the session's, never a
 * value from the request. Read only (no settlement, no cancellation, no
 * accounting entry) except the admin's overdue delay. The calculations live in
 * receivables-core.ts and lib/receivables/*.
 */

export const RECEIVABLES_ROLES = RECEIVABLES_VIEW_ROLES;

export async function getReceivablesOverview(): Promise<ReceivablesOverviewDto> {
  const user = await requireOrganizationUser([...RECEIVABLES_ROLES]);
  await requireDashboardAccess(user);
  const settings = await readReceivablesSettings(prisma, user.organizationId);
  const overview = await loadReceivablesOverview(prisma, user.organizationId, { now: new Date(), settings });
  return {
    ...overview,
    debtors: overview.debtors.map((row) => ({ ...row, accountCode: resolveCustomerAuxiliaryCode(row.code) })),
    creditors: {
      ...overview.creditors,
      rows: overview.creditors.rows.map((row) => ({ ...row, accountCode: resolveCustomerAuxiliaryCode(row.code) })),
    },
  };
}

export async function getCustomerReceivableDetail(customerId: string): Promise<CustomerReceivableDetailDto> {
  const user = await requireOrganizationUser([...RECEIVABLES_ROLES]);
  await requireDashboardAccess(user);
  const settings = await readReceivablesSettings(prisma, user.organizationId);
  const detail = await loadCustomerReceivableDetail(prisma, user.organizationId, customerId, { now: new Date(), settings });
  return { ...detail, customer: { ...detail.customer, accountCode: resolveCustomerAuxiliaryCode(detail.customer.code) } };
}

export async function updateReceivablesSettings(input: unknown): Promise<ReceivablesSettings> {
  const user = await requireOrganizationUser([...RECEIVABLES_ROLES]);
  await requireDashboardAccess(user);
  const raw = (input && typeof input === "object" ? (input as { overdueDays?: unknown }).overdueDays : undefined);
  const validation = validateOverdueDays(raw);
  if (!validation.ok) {
    throw new OperationsServiceError(validation.message, 422, { overdueDays: validation.message });
  }
  return prisma.$transaction((tx) => writeReceivablesSettings(tx, user.organizationId, user.id, validation.value));
}
