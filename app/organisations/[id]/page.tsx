import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { OrganizationDetailView } from "@/components/organizations/organization-detail-view";
import { getOrganizationById } from "@/lib/server/organizations";

export const metadata: Metadata = {
  title: "Detail organisation",
};

export default async function OrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const organization = await getOrganizationById(id);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/organisations">
          <Button type="button" variant="outline">
            <ArrowLeft className="h-4 w-4" />
            Retour
          </Button>
        </Link>
      </div>

      <OrganizationDetailView organization={organization} />
    </div>
  );
}
