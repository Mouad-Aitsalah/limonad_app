import type { Metadata } from "next";

import { DepotsView } from "@/components/depots/depots-view";
import { getDepots } from "@/lib/server/depots";
import { requireModulePage } from "@/lib/server/module-guard";

export const metadata: Metadata = {
  title: "Dépôts",
};

export default async function DepotsPage() {
  await requireModulePage("stock");
  const depots = await getDepots();

  return <DepotsView initialDepots={depots} />;
}
