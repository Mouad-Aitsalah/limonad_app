import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CreditNoteTabs } from "@/components/credit-notes/credit-note-tabs";
import { getCurrentSessionUser } from "@/lib/server/auth";
import { getCreditNotes } from "@/lib/server/credit-notes";
import { getCustomers } from "@/lib/server/customers";
import { getProducts } from "@/lib/server/products";
import { getStockLocations } from "@/lib/server/stock-locations";
import { getSupplierPartners } from "@/lib/server/suppliers";
import type { UserRole } from "@/types/auth";

export const metadata: Metadata = {
  title: "Avoirs",
};

export const dynamic = "force-dynamic";

const allowedRoles: UserRole[] = ["admin", "depot_manager", "cashier"];

export default async function AvoirsPage() {
  const currentUser = await getCurrentSessionUser();

  if (!currentUser) {
    redirect("/login");
  }

  if (!allowedRoles.includes(currentUser.role)) {
    redirect("/driver");
  }

  const [creditNotes, customers, suppliers, products, locations] = await Promise.all([
    getCreditNotes(currentUser),
    getCustomers(),
    getSupplierPartners(),
    getProducts(),
    getStockLocations(),
  ]);

  return (
    <CreditNoteTabs
      initialCreditNotes={creditNotes}
      customers={customers}
      suppliers={suppliers}
      products={products}
      locations={locations}
      currentUser={currentUser}
    />
  );
}
