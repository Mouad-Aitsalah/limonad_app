import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CustomerOrdersView } from "@/components/customer-orders/customer-orders-view";
import { AuthServiceError } from "@/lib/server/auth";
import { listCustomerOrders } from "@/lib/server/customer-orders";

export const metadata: Metadata = {
  title: "Commandes en ligne",
};

export default async function CustomerOrdersPage() {
  let initialPage;
  try {
    initialPage = await listCustomerOrders({ status: "SUBMITTED" });
  } catch (error) {
    if (error instanceof AuthServiceError) {
      redirect("/dashboard");
    }
    throw error;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Commandes en ligne</h1>
        <p className="text-sm text-muted-foreground">
          Commandes envoyées depuis l&apos;Espace Client. Acceptez-les puis ouvrez-les dans le POS : la facture est
          créée uniquement par la validation normale du POS.
        </p>
      </div>
      <CustomerOrdersView initialPage={initialPage} />
    </div>
  );
}
