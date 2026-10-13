import type { Metadata } from "next";

import { PurchasesView } from "@/components/achats/purchases-view";
import { requireModulePage } from "@/lib/server/module-guard";

export const metadata: Metadata = {
  title: "Historique des achats",
};

export default async function AchatsPage() {
  await requireModulePage("purchases");
  return <PurchasesView />;
}
