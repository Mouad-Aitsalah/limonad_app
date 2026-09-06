import type { Metadata } from "next";

import { NewPurchaseView } from "@/components/achats/new-purchase-view";

export const metadata: Metadata = {
  title: "Nouvel achat",
};

export default function NewPurchasePage() {
  return <NewPurchaseView />;
}
