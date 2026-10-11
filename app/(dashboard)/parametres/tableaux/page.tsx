import type { Metadata } from "next";

import { TableLabelsSettingsView } from "@/components/parametres/table-labels-settings-view";
import { getTableLabelsForAdmin } from "@/lib/server/organization-settings";

export const metadata: Metadata = {
  title: "Personnalisation des tableaux",
};

export default async function TableLabelsSettingsPage() {
  const labels = await getTableLabelsForAdmin();
  return <TableLabelsSettingsView initialLabels={labels} />;
}
