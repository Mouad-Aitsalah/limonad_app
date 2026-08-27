import type { Metadata } from "next";

import { TrucksView } from "@/components/trucks/trucks-view";
import { getDepots } from "@/lib/server/depots";
import { getTrucks } from "@/lib/server/trucks";

export const metadata: Metadata = {
  title: "Camions",
};

export default async function CamionsPage() {
  const [trucks, depots] = await Promise.all([getTrucks(), getDepots()]);

  return <TrucksView initialTrucks={trucks} depots={depots} />;
}
