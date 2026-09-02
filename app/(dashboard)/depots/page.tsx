import type { Metadata } from "next";

import { DepotsView } from "@/components/depots/depots-view";
import { getDepots } from "@/lib/server/depots";

export const metadata: Metadata = {
  title: "Dépôts",
};

export default async function DepotsPage() {
  const depots = await getDepots();

  return <DepotsView initialDepots={depots} />;
}
