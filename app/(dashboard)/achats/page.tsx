import type { Metadata } from "next";

import { PurchasesView } from "@/components/achats/purchases-view";

export const metadata: Metadata = {
  title: "Achats",
};

export default function AchatsPage() {
  return <PurchasesView />;
}
