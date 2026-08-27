"use client";

import * as React from "react";
import Link from "next/link";
import { Building2, Package, ShoppingCart, Users } from "lucide-react";

import { MetricCard } from "@/components/ui/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import type { OrganizationDetailDto, OrganizationSummaryDto } from "@/types/organization";
import { OrganizationFormDialog } from "@/components/organizations/organization-form-dialog";
import { OrganizationStatusBadge } from "@/components/organizations/organization-status-badge";

export function OrganizationsView({
  initialOrganizations,
}: {
  initialOrganizations: OrganizationSummaryDto[];
}) {
  const [organizations, setOrganizations] = React.useState(initialOrganizations);
  const [search, setSearch] = React.useState("");

  const filteredOrganizations = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return organizations;
    }

    return organizations.filter((organization) =>
      [
        organization.name,
        organization.code,
        organization.tradeName ?? "",
        organization.city ?? "",
        organization.admin?.email ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [organizations, search]);

  const totals = React.useMemo(
    () => ({
      organizations: organizations.length,
      active: organizations.filter((organization) => organization.status === "ACTIVE").length,
      products: organizations.reduce(
        (sum, organization) => sum + organization.stats.productsCount,
        0,
      ),
      sales: organizations.reduce((sum, organization) => sum + organization.stats.salesCount, 0),
      users: organizations.reduce((sum, organization) => sum + organization.stats.usersCount, 0),
    }),
    [organizations],
  );

  function upsertOrganization(nextOrganization: OrganizationDetailDto) {
    setOrganizations((current) => {
      const summary: OrganizationSummaryDto = {
        id: nextOrganization.id,
        code: nextOrganization.code,
        name: nextOrganization.name,
        tradeName: nextOrganization.tradeName,
        address: nextOrganization.address,
        city: nextOrganization.city,
        country: nextOrganization.country,
        phone: nextOrganization.phone,
        email: nextOrganization.email,
        status: nextOrganization.status,
        admin: nextOrganization.admin,
        stats: nextOrganization.stats,
        createdAt: nextOrganization.createdAt,
        updatedAt: nextOrganization.updatedAt,
      };

      const existingIndex = current.findIndex(
        (organization) => organization.id === nextOrganization.id,
      );
      if (existingIndex === -1) {
        return [summary, ...current];
      }

      const next = [...current];
      next[existingIndex] = summary;
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          eyebrow="Super Admin"
          title="Organisations"
          value={String(totals.organizations)}
          helper={`${totals.active} active${totals.active > 1 ? "s" : ""}`}
          icon={Building2}
          accent="navy"
        />
        <MetricCard
          eyebrow="Utilisateurs"
          title="Comptes"
          value={String(totals.users)}
          helper="Admins, caissiers et chauffeurs cumules."
          icon={Users}
          accent="green"
        />
        <MetricCard
          eyebrow="Catalogue"
          title="Produits"
          value={String(totals.products)}
          helper="Somme des catalogues organisationnels."
          icon={Package}
          accent="orange"
        />
        <MetricCard
          eyebrow="Business"
          title="Ventes"
          value={String(totals.sales)}
          helper="Nombre total de ventes rattachees."
          icon={ShoppingCart}
          accent="blue"
        />
      </div>

      <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
        <CardContent className="space-y-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Rechercher une organisation, un code, une ville ou un admin..."
              className="max-w-xl"
            />
            <p className="text-sm text-muted-foreground">
              {filteredOrganizations.length} organisation
              {filteredOrganizations.length > 1 ? "s" : ""}
            </p>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organisation</TableHead>
                <TableHead>Admin</TableHead>
                <TableHead>Caissiers</TableHead>
                <TableHead>Chauffeurs</TableHead>
                <TableHead>Produits</TableHead>
                <TableHead>Clients</TableHead>
                <TableHead>Ventes</TableHead>
                <TableHead>Creation</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredOrganizations.length > 0 ? (
                filteredOrganizations.map((organization) => (
                  <TableRow key={organization.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium text-foreground">{organization.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {organization.code}
                          {organization.city ? ` - ${organization.city}` : ""}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {organization.admin ? organization.admin.email : "-"}
                    </TableCell>
                    <TableCell>{organization.stats.cashiersCount}</TableCell>
                    <TableCell>{organization.stats.driversCount}</TableCell>
                    <TableCell>{organization.stats.productsCount}</TableCell>
                    <TableCell>{organization.stats.customersCount}</TableCell>
                    <TableCell>{organization.stats.salesCount}</TableCell>
                    <TableCell>{formatFrenchDate(organization.createdAt)}</TableCell>
                    <TableCell>
                      <OrganizationStatusBadge status={organization.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Link href={`/organisations/${organization.id}`}>
                          <Button type="button" variant="outline" size="sm">
                            Voir
                          </Button>
                        </Link>
                        <OrganizationFormDialog
                          initialOrganization={organization}
                          triggerLabel="Modifier"
                          triggerVariant="outline"
                          onSaved={upsertOrganization}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={10}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    Aucune organisation ne correspond a votre recherche.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function formatFrenchDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}
