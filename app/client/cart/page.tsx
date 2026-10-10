import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getCurrentClient } from "@/lib/server/client-auth";
import { getClientOrganizationIdentity } from "@/lib/server/client-catalog";
import { ClientCartView } from "@/components/client/client-cart-view";

export const metadata: Metadata = {
  title: "Mon panier | Espace Client COMDIS",
};

export default async function ClientCartPage() {
  const client = await getCurrentClient();
  if (!client) {
    redirect("/client/login");
  }

  // organizationId comes ONLY from the verified session above - never from a
  // URL, a query string or anything else a client could influence.
  const organization = await getClientOrganizationIdentity(client.organizationId);

  return <ClientCartView client={client} organization={organization} />;
}
