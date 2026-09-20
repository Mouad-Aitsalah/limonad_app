import "server-only";

import { validateLogoDataUrl } from "@/lib/logo-validation";
import { prisma } from "@/lib/prisma";
import { OperationsServiceError } from "@/lib/server/depots";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import type { SupplierPartnerDto } from "@/types/operations-dto";
import type { ProductOptionDto } from "@/types/product-dto";

export async function getSuppliers(): Promise<ProductOptionDto[]> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  return prisma.supplier.findMany({
    where: { active: true, organizationId: currentUser.organizationId },
    select: { id: true, name: true, logoUrl: true },
    orderBy: { name: "asc" },
  });
}

export async function getSupplierPartners(): Promise<SupplierPartnerDto[]> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  const suppliers = await prisma.supplier.findMany({
    where: { organizationId: currentUser.organizationId },
    select: {
      id: true,
      code: true,
      name: true,
      logoUrl: true,
      phone: true,
      email: true,
      address: true,
      city: true,
      ice: true,
      taxId: true,
      active: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { products: true, purchases: true } },
    },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });

  return suppliers.map((supplier) => ({
    id: supplier.id,
    code: supplier.code,
    name: supplier.name,
    logoUrl: supplier.logoUrl,
    phone: supplier.phone,
    email: supplier.email,
    address: supplier.address,
    city: supplier.city,
    ice: supplier.ice,
    taxId: supplier.taxId,
    active: supplier.active,
    productsCount: supplier._count.products,
    purchasesCount: supplier._count.purchases,
    createdAt: supplier.createdAt.toISOString(),
    updatedAt: supplier.updatedAt.toISOString(),
  }));
}

export async function updateSupplierLogo(
  supplierId: string,
  logoDataUrl: string | null,
): Promise<{ id: string; logoUrl: string | null }> {
  const user = await requireOrganizationUser(["admin"]);
  let value: string | null = null;

  if (typeof logoDataUrl === "string" && logoDataUrl.trim().length > 0) {
    const validation = validateLogoDataUrl(logoDataUrl);
    if (!validation.ok) {
      throw new OperationsServiceError(validation.message, 422, { logo: validation.message });
    }
    value = logoDataUrl.trim();
  }

  const supplier = await prisma.supplier.update({
    where: { id: supplierId, organizationId: user.organizationId },
    data: { logoUrl: value },
    select: { id: true, logoUrl: true },
  });

  await prisma.auditLog.create({
    data: {
      organizationId: user.organizationId,
      userId: user.id,
      action: value ? "SUPPLIER_LOGO_SET" : "SUPPLIER_LOGO_CLEARED",
      entityType: "Supplier",
      entityId: supplier.id,
      newValue: { hasLogo: Boolean(value) },
    },
  });

  return supplier;
}
