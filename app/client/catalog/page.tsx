import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getCurrentClient } from "@/lib/server/client-auth";
import { getClientCatalog } from "@/lib/server/client-catalog";
import { ClientCatalogView } from "@/components/client/client-catalog-view";

export const metadata: Metadata = {
  title: "Catalogue | Espace Client COMDIS",
};

export default async function ClientCatalogPage() {
  const client = await getCurrentClient();
  if (!client) {
    redirect("/client/login");
  }

  // organizationId comes ONLY from the verified session above - never from a
  // URL, a query string or anything else a client could influence.
  const catalog = await getClientCatalog(client.organizationId);

  return <ClientCatalogView client={client} catalog={catalog} />;
}
