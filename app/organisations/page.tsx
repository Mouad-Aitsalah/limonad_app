import type { Metadata } from "next";

import { AppPageHeader } from "@/components/ui/app-page-header";
import { OrganizationFormDialog } from "@/components/organizations/organization-form-dialog";
import { OrganizationsView } from "@/components/organizations/organizations-view";
import { listOrganizations } from "@/lib/server/organizations";

export const metadata: Metadata = {
  title: "Organisations",
};

export default async function OrganizationsPage() {
  const organizations = await listOrganizations();

  return (
    <div className="space-y-6">
      <AppPageHeader
        eyebrow="Super Admin"
        title="Organisations"
        description="Creez, pilotez et isolez chaque entreprise COMDIS depuis un espace global dedie."
        actions={<OrganizationFormDialog />}
      />

      <OrganizationsView initialOrganizations={organizations} />
    </div>
  );
}
