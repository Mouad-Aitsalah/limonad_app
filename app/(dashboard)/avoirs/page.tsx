import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CreditNoteTabs } from "@/components/credit-notes/credit-note-tabs";
import { getCurrentSessionUser } from "@/lib/server/auth";
import { getCustomers } from "@/lib/server/customers";
import { getProductPickerPreload } from "@/lib/server/products";
import { getStockLocations } from "@/lib/server/stock-locations";
import { getSupplierPartners } from "@/lib/server/suppliers";
import type { UserRole } from "@/types/auth";
import { requireModulePage } from "@/lib/server/module-guard";

export const metadata: Metadata = {
  title: "Avoir client / fournisseur",
};

export const dynamic = "force-dynamic";

// Creating an avoir is a desk operation: administrator and cashier only (the server enforces the same).
const allowedRoles: UserRole[] = ["admin", "cashier"];

export default async function AvoirsPage() {
  await requireModulePage("creditNotes");
  const currentUser = await getCurrentSessionUser();

  if (!currentUser) {
    redirect("/login");
  }

  if (!allowedRoles.includes(currentUser.role)) {
    redirect("/driver");
  }

  // Phase 3 CRITICAL #1 fix: small bounded preload instead of getProducts()
  // (measured 12.5s/56MB at 100k products) - already ACTIVE-only. See
  // CreditNotePosScreen's product search.
  const [customers, suppliers, products, locations] = await Promise.all([
    getCustomers(),
    getSupplierPartners(),
    getProductPickerPreload(),
    getStockLocations(),
  ]);

  return (
    <CreditNoteTabs
      customers={customers}
      suppliers={suppliers}
      products={products}
      locations={locations}
    />
  );
}
