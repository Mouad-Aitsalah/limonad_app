import "server-only";

import { prisma } from "@/lib/prisma";
import {
  parseProductColumnSettings,
  type ProductColumnSettings,
} from "@/lib/product-columns";
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
  await prisma.organization.update({
    where: { id: user.organizationId },
    data: { productColumnSettings: settings },
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
