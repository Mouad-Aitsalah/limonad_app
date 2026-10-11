import "server-only";

import { prisma } from "@/lib/prisma";
import {
  parseProductColumnSettings,
  type ProductColumnSettings,
} from "@/lib/product-columns";
import {
  findInvalidLabel,
  findTablePage,
  parseTableLabels,
  sanitizePageLabels,
  withPageLabels,
  type TableLabels,
} from "@/lib/table-labels/labels";
import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import type { Prisma } from "@/lib/generated/prisma/client";

/**
 * Organisation-wide settings stored on the Organization row:
 *   - quantityPricingEnabled: "Activer la tarification automatique selon la
 *     quantité" (Paramètres -> Tarification). Off by default.
 *   - productColumnSettings: the columns of the /produits table.
 *
 * Both are read and written for the caller's OWN organisation only
 * (`where: { id: user.organizationId }`, never an id from the request), and
 * only an admin can change them - enforced here, whatever the UI shows. Every
 * change is written to the audit log.
 */

export type PricingSettingsDto = {
  quantityPricingEnabled: boolean;
};

export type ProductColumnSettingsDto = {
  settings: ProductColumnSettings;
  /** Only an admin may change the columns; every other role just sees them. */
  canEdit: boolean;
};

/** Read by createCounterSale / reviseSale / the counter POS context, inside or outside a transaction. */
export async function readQuantityPricingEnabled(
  db: Pick<Prisma.TransactionClient, "organization">,
  organizationId: string,
): Promise<boolean> {
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { quantityPricingEnabled: true },
  });
  return organization?.quantityPricingEnabled === true;
}

/** Loader of /parametres/tarification. */
export async function getPricingSettingsForAdmin(): Promise<PricingSettingsDto> {
  const user = await requireOrganizationUser(["admin"]);
  return { quantityPricingEnabled: await readQuantityPricingEnabled(prisma, user.organizationId) };
}

export async function updatePricingSettings(input: unknown): Promise<PricingSettingsDto> {
  const user = await requireOrganizationUser(["admin"]);
  const enabled = (input as { quantityPricingEnabled?: unknown } | null)?.quantityPricingEnabled;
  if (typeof enabled !== "boolean") {
    throw new OperationsServiceError("Valeur de tarification invalide.", 422, {
      quantityPricingEnabled: "Valeur attendue : activé ou désactivé.",
    });
  }

  const previous = await readQuantityPricingEnabled(prisma, user.organizationId);
  const organization = await prisma.organization.update({
    where: { id: user.organizationId },
    data: { quantityPricingEnabled: enabled },
    select: { id: true, quantityPricingEnabled: true },
  });

  await prisma.auditLog.create({
    data: {
      organizationId: user.organizationId,
      userId: user.id,
      action: enabled ? "QUANTITY_PRICING_ENABLED" : "QUANTITY_PRICING_DISABLED",
      entityType: "Organization",
      entityId: organization.id,
      oldValue: { quantityPricingEnabled: previous },
      newValue: { quantityPricingEnabled: organization.quantityPricingEnabled },
    },
  });

  return { quantityPricingEnabled: organization.quantityPricingEnabled };
}

/** Loader of /produits: every role that can open the page sees the organisation's columns. */
export async function getProductColumnSettings(): Promise<ProductColumnSettingsDto> {
  const user = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const organization = await prisma.organization.findUnique({
    where: { id: user.organizationId },
    select: { productColumnSettings: true },
  });
  if (!organization) throw new AuthServiceError("Organisation introuvable.", 404);
  return {
    settings: parseProductColumnSettings(organization.productColumnSettings),
    canEdit: user.role === "admin",
  };
}

export async function updateProductColumnSettings(input: unknown): Promise<ProductColumnSettingsDto> {
  const user = await requireOrganizationUser(["admin"]);
  // Only known columns with a boolean survive; "Désignation" can never be hidden.
  const settings = parseProductColumnSettings(input);

  const before = await prisma.organization.findUnique({
    where: { id: user.organizationId },
    select: { productColumnSettings: true },
  });
  // The same JSON also holds the organisation's custom table labels ("labels"):
  // only the "columns" part is replaced here.
  const stored =
    before?.productColumnSettings && typeof before.productColumnSettings === "object" && !Array.isArray(before.productColumnSettings)
      ? (before.productColumnSettings as Record<string, unknown>)
      : {};
  await prisma.organization.update({
    where: { id: user.organizationId },
    data: { productColumnSettings: { ...stored, ...settings } as Prisma.InputJsonObject },
    select: { id: true },
  });

  await prisma.auditLog.create({
    data: {
      organizationId: user.organizationId,
      userId: user.id,
      action: "PRODUCT_COLUMNS_UPDATED",
      entityType: "Organization",
      entityId: user.organizationId,
      oldValue: parseProductColumnSettings(before?.productColumnSettings),
      newValue: settings,
    },
  });

  return { settings, canEdit: true };
}

/**
 * Custom column labels (Paramètres -> Personnalisation des tableaux), stored
 * under "labels" in Organization.productColumnSettings - see
 * lib/table-labels/labels.ts. Read by the dashboard layout for EVERY staff
 * role (they all see the labels), written by an admin only.
 */
async function readTableLabels(organizationId: string): Promise<TableLabels> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { productColumnSettings: true },
  });
  return parseTableLabels(organization?.productColumnSettings);
}

/** Dashboard layout: the labels of the signed-in user's organisation, {} when there is none. */
export async function getTableLabelsForShell(): Promise<TableLabels> {
  try {
    const user = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
    return await readTableLabels(user.organizationId);
  } catch {
    // No session / another role: every table keeps its default labels.
    return {};
  }
}

/** Loader of /parametres/tableaux. */
export async function getTableLabelsForAdmin(): Promise<TableLabels> {
  const user = await requireOrganizationUser(["admin"]);
  return readTableLabels(user.organizationId);
}

/**
 * Replaces the labels of ONE page (body: { page, labels: { [table]: { [column]: text } } }).
 * Empty / default texts are not stored, so an empty object resets the page to
 * its default labels. The other pages and the /produits column choice are kept.
 */
export async function updateTablePageLabels(input: unknown): Promise<TableLabels> {
  const user = await requireOrganizationUser(["admin"]);
  const body = (input && typeof input === "object" ? input : {}) as { page?: unknown; labels?: unknown };
  const page = typeof body.page === "string" ? findTablePage(body.page) : undefined;
  if (!page) {
    throw new OperationsServiceError("Page inconnue.", 422, { page: "Page inconnue." });
  }
  const invalid = findInvalidLabel(page, body.labels);
  if (invalid) {
    throw new OperationsServiceError(invalid, 422, { labels: invalid });
  }
  const pageLabels = sanitizePageLabels(page, body.labels);

  const before = await prisma.organization.findUnique({
    where: { id: user.organizationId },
    select: { productColumnSettings: true },
  });
  if (!before) throw new AuthServiceError("Organisation introuvable.", 404);
  const next = withPageLabels(before.productColumnSettings, page.key, pageLabels);
  await prisma.organization.update({
    where: { id: user.organizationId },
    data: { productColumnSettings: next as Prisma.InputJsonObject },
    select: { id: true },
  });

  await prisma.auditLog.create({
    data: {
      organizationId: user.organizationId,
      userId: user.id,
      action: "TABLE_LABELS_UPDATED",
      entityType: "Organization",
      entityId: user.organizationId,
      oldValue: { page: page.key, labels: parseTableLabels(before.productColumnSettings)[page.key] ?? {} },
      newValue: { page: page.key, labels: pageLabels },
    },
  });

  return parseTableLabels(next);
}
