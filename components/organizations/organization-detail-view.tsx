"use client";

import { Building2, Package, ShoppingCart, Truck, Users } from "lucide-react";

import { OrganizationFormDialog } from "@/components/organizations/organization-form-dialog";
import { OrganizationStatusBadge } from "@/components/organizations/organization-status-badge";
import { AppPageHeader } from "@/components/ui/app-page-header";
import { Card, CardContent } from "@/components/ui/card";
import { MetricCard } from "@/components/ui/metric-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { OrganizationDetailDto } from "@/types/organization";

export function OrganizationDetailView({
  organization,
}: {
  organization: OrganizationDetailDto;
}) {
  return (
    <div className="space-y-6">
      <AppPageHeader
        eyebrow="Organisation"
        title={organization.name}
        description={`Code ${organization.code}${organization.tradeName ? ` - ${organization.tradeName}` : ""}`}
        actions={
          <OrganizationFormDialog
            initialOrganization={organization}
            triggerLabel="Modifier organisation"
            onSaved={() => window.location.reload()}
          />
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          eyebrow="Statut"
          title="Organisation"
          value={organization.status}
          helper={organization.admin?.email ?? "Admin principal non defini"}
          icon={Building2}
          accent="navy"
        />
        <MetricCard
          eyebrow="Equipe"
          title="Utilisateurs"
          value={String(organization.stats.usersCount)}
          helper={`${organization.stats.adminsCount} admins et ${organization.stats.cashiersCount} caissiers`}
          icon={Users}
          accent="green"
        />
        <MetricCard
          eyebrow="Chauffeurs"
          title="Livraison"
          value={String(organization.stats.driversCount)}
          helper="Comptes chauffeur rattaches."
          icon={Truck}
          accent="orange"
        />
        <MetricCard
          eyebrow="Business"
          title="Ventes"
          value={String(organization.stats.salesCount)}
          helper={`${organization.stats.productsCount} produits et ${organization.stats.customersCount} clients`}
          icon={ShoppingCart}
          accent="blue"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_1.4fr]">
        <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
          <CardContent className="space-y-4">
            <SectionTitle title="Fiche organisation" />
            <InfoRow label="Nom" value={organization.name} />
            <InfoRow label="Code" value={organization.code} />
            <InfoRow label="Statut" value={<OrganizationStatusBadge status={organization.status} />} />
            <InfoRow label="Creation" value={formatFrenchDate(organization.createdAt)} />
            <InfoRow label="Adresse" value={organization.address ?? "-"} />
            <InfoRow label="Ville" value={organization.city ?? "-"} />
            <InfoRow label="Pays" value={organization.country ?? "-"} />
            <InfoRow label="Telephone" value={organization.phone ?? "-"} />
            <InfoRow label="Email" value={organization.email ?? "-"} />
          </CardContent>
        </Card>

        <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
          <CardContent className="space-y-4">
            <SectionTitle title="Equipe et activite" />
            <div className="grid gap-3 sm:grid-cols-2">
              <MiniStat label="Admin principal" value={organization.admin?.fullName ?? "-"} helper={organization.admin?.email ?? ""} />
              <MiniStat label="Utilisateurs" value={String(organization.stats.usersCount)} helper="Tous roles confondus" />
              <MiniStat label="Caissiers" value={String(organization.stats.cashiersCount)} helper="POS rattaches" />
              <MiniStat label="Chauffeurs" value={String(organization.stats.driversCount)} helper="Acces chauffeur" />
              <MiniStat label="Produits" value={String(organization.stats.productsCount)} helper="Catalogue metier" />
              <MiniStat label="Achats" value={String(organization.stats.purchasesCount)} helper="Documents achat" />
              <MiniStat label="Clients" value={String(organization.stats.customersCount)} helper="Base commerciale" />
              <MiniStat label="Ventes" value={String(organization.stats.salesCount)} helper="Historique facture" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
        <CardContent className="space-y-4">
          <SectionTitle title="Utilisateurs de l'organisation" />

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Creation</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {organization.users.length > 0 ? (
                organization.users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.fullName}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>{user.role}</TableCell>
                    <TableCell>{user.status}</TableCell>
                    <TableCell>{formatFrenchDate(user.createdAt)}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    Aucun utilisateur pour cette organisation.
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

function SectionTitle({ title }: { title: string }) {
  return <h2 className="font-heading text-lg font-semibold text-foreground">{title}</h2>;
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl bg-muted/35 px-4 py-3">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="text-right text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="rounded-2xl bg-muted/35 px-4 py-4">
      <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-lg font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{helper}</p>
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
