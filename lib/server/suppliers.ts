import "server-only";

import { prisma } from "@/lib/prisma";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import type { SupplierPartnerDto } from "@/types/operations-dto";
import type { ProductOptionDto } from "@/types/product-dto";

export async function getSuppliers(): Promise<ProductOptionDto[]> {
  const currentUser = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
  return prisma.supplier.findMany({
    where: { active: true, organizationId: currentUser.organizationId },
    select: { id: true, name: true },
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
