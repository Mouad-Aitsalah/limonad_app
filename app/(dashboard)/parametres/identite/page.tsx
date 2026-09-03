import type { Metadata } from "next";

import { CompanyIdentityView } from "@/components/parametres/company-identity-view";
import { getOrganizationIdentityForAdmin } from "@/lib/server/organization-identity";

export const metadata: Metadata = {
  title: "Identité de l'entreprise",
};

export default async function CompanyIdentityPage() {
  const identity = await getOrganizationIdentityForAdmin();
  return <CompanyIdentityView initialIdentity={identity} />;
}
