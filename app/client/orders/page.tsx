import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ClientOrdersView } from "@/components/client/client-orders-view";
import { prisma } from "@/lib/prisma";
import { getCurrentClient } from "@/lib/server/client-auth";
import { getClientOrganizationIdentity } from "@/lib/server/client-catalog";
import { listClientOrders } from "@/lib/server/client-portal-core";

export const metadata: Metadata = {
  title: "Mes commandes | Espace Client COMDIS",
};

export default async function ClientOrdersPage() {
  const client = await getCurrentClient();
  if (!client) {
    redirect("/client/login");
  }

  // Scope (organisation + customer) comes ONLY from the verified session.
  const [organization, orders] = await Promise.all([
    getClientOrganizationIdentity(client.organizationId),
    listClientOrders(prisma, client),
  ]);

  return <ClientOrdersView client={client} organization={organization} orders={orders} />;
}
