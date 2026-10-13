import type { Metadata } from "next";

import { NewPurchaseView } from "@/components/achats/new-purchase-view";
import { requireModulePage } from "@/lib/server/module-guard";

export const metadata: Metadata = {
  title: "Nouvel achat",
};

export default async function NewPurchasePage() {
  await requireModulePage("purchases");
  return <NewPurchaseView />;
}
