import type { Metadata } from "next";

import { PricingSettingsView } from "@/components/parametres/pricing-settings-view";
import { getPricingSettingsForAdmin } from "@/lib/server/organization-settings";

export const metadata: Metadata = {
  title: "Tarification",
};

export default async function PricingSettingsPage() {
  const settings = await getPricingSettingsForAdmin();
  return <PricingSettingsView initialSettings={settings} />;
}
