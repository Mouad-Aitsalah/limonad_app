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
      <CustomerOrdersView initialPage={initialPage} />
    </div>
  );
}
