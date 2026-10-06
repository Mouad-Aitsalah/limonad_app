"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Clock3,
  MapPinned,
  RefreshCw,
  Route,
  ShoppingCart,
  Store,
  Truck,
  Users,
} from "lucide-react";

import { AppPageHeader } from "@/components/ui/app-page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SectionCard } from "@/components/ui/section-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LiveFleetView } from "@/components/trajets/live-fleet-view";
import { resolveRouteEndpoints } from "@/lib/truck-routes/route-endpoints";
import {
  formatRouteDateTime,
  formatRouteDay,
  formatRouteTime,
} from "@/lib/truck-routes/route-format";
import { formatCurrency } from "@/lib/utils";
import type {
  TruckRoutesPageData,
  TruckRouteVisitDto,
} from "@/types/truck-routes";

const TrajetsMap = dynamic(
  () =>
    import("./trajets-map").then((module) => ({
      default: module.TrajetsMap,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="h-[680px] rounded-[26px] bg-[linear-gradient(180deg,#f8fafc_0%,#eff6ff_100%)]" />
    ),
  },
);

export function TrajetsView({ initialData }: { initialData: TruckRoutesPageData }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const data = initialData;
  const route = data.route;

  function updateFilters(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(updates)) {
      if (!value) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }

    router.replace(`${pathname}?${params.toString()}`);
  }

  const endpoints = route ? resolveRouteEndpoints(route) : null;
  const selectedDriverName = route?.driver.name ?? resolveSelectedDriverName(data);
  const selectedTruckLabel = route
    ? `${route.truck.code} - ${route.truck.registration}`
    : resolveSelectedTruckLabel(data);

  return (
    <div className="space-y-6">
      <AppPageHeader
        eyebrow="TRACABILITE"
        title="Trajets des camions"
        description="Suivez vos camions en direct ou consultez l'historique GPS d'une tournee terminee."
        actions={
          <Button
            type="button"
            variant="outline"
            className="rounded-2xl"
            onClick={() => router.refresh()}
          >
            <RefreshCw className="h-4 w-4" />
            Actualiser
          </Button>
        }
      />

      <Tabs defaultValue="direct">
        <TabsList>
          <TabsTrigger value="direct">En direct</TabsTrigger>
          <TabsTrigger value="historique">Historique</TabsTrigger>
        </TabsList>

        <TabsContent value="direct" className="pt-4">
          <LiveFleetView />
        </TabsContent>

        <TabsContent value="historique" className="space-y-6 pt-4">
      <SectionCard
        title="Filtres"
        description="Choisissez une date, un camion et une tournee pour charger le trajet reel enregistre."
      >
        <div className="grid gap-4 lg:grid-cols-5">
          <Field label="Date">
            <input
              type="date"
              value={data.filters.date}
              onChange={(event) =>
                updateFilters({
                  date: event.target.value,
                  tourId: null,
                })
              }
              className="h-11 w-full rounded-2xl border border-input bg-white/88 px-4 text-sm outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/12"
            />
          </Field>

          <Field label="Camion">
            <select
              value={data.filters.truckId ?? ""}
              onChange={(event) =>
                updateFilters({
                  truckId: event.target.value || null,
                  tourId: null,
                })
              }
              className="h-11 w-full rounded-2xl border border-input bg-white/88 px-4 text-sm outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/12"
            >
              <option value="">Tous les camions</option>
              {data.filterOptions.trucks.map((truck) => (
                <option key={truck.id} value={truck.id}>
                  {truck.label} - {truck.secondary}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Chauffeur">
            <select
              value={data.filters.driverId ?? ""}
              onChange={(event) =>
                updateFilters({
                  driverId: event.target.value || null,
                  tourId: null,
                })
              }
              className="h-11 w-full rounded-2xl border border-input bg-white/88 px-4 text-sm outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/12"
            >
              <option value="">Tous les chauffeurs</option>
              {data.filterOptions.drivers.map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Statut tournee">
            <select
              value={data.filters.status ?? ""}
              onChange={(event) =>
                updateFilters({
                  status: event.target.value || null,
                  tourId: null,
                })
              }
              className="h-11 w-full rounded-2xl border border-input bg-white/88 px-4 text-sm outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/12"
            >
              <option value="">Tous les statuts</option>
              {data.filterOptions.statuses.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Tournee">
            <select
              value={data.filters.tourId ?? ""}
              onChange={(event) =>
                updateFilters({
                  tourId: event.target.value || null,
                })
              }
              disabled={data.filterOptions.tours.length === 0}
              className="h-11 w-full rounded-2xl border border-input bg-white/88 px-4 text-sm outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/12 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">
                {data.filterOptions.tours.length === 0
                  ? "Aucune tournee"
                  : "Selectionner une tournee"}
              </option>
              {data.filterOptions.tours.map((tourOption) => (
                <option key={tourOption.id} value={tourOption.id}>
                  {tourOption.code} - {tourOption.driverName}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <ReadOnlyInfo label="Camion" value={selectedTruckLabel || "Non selectionne"} />
          <ReadOnlyInfo label="Chauffeur" value={selectedDriverName || "Non selectionne"} />
          <ReadOnlyInfo
            label="Statut"
            value={route ? routeStatusLabel(route.tour.status) : "-"}
          />
        </div>
      </SectionCard>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)]">
        <Card className="surface-card overflow-hidden py-0">
          <CardHeader className="border-b border-border/70 px-6 py-5">
            <div>
              <CardTitle>Carte du trajet</CardTitle>
              <CardDescription>
                Polyline GPS reelle, depart, arrivee et clients geolocalises de la tournee.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {route ? (
              <TrajetsMap route={route} />
            ) : (
              <EmptyState message={data.message ?? "Aucune tournee trouvee."} className="m-6" />
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <SectionCard
            title="Resume du trajet"
            description="Indicateurs calcules a partir des points GPS et des ventes liees a la tournee."
          >
            {route ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <MetricCard
                  icon={Route}
                  label="Distance"
                  value={`${route.summary.distanceKm.toFixed(1)} km`}
                />
                <MetricCard
                  icon={Clock3}
                  label="Duree"
                  value={formatDuration(route.summary.durationMinutes)}
                />
                <MetricCard
                  icon={MapPinned}
                  label="Points GPS"
                  value={String(route.summary.pointsCount)}
                  secondary={
                    route.summary.ignoredPointsCount > 0
                      ? `${route.summary.ignoredPointsCount} ignores`
                      : undefined
                  }
                />
                <MetricCard
                  icon={Users}
                  label="Clients visites"
                  value={String(route.summary.clientsVisited)}
                />
                <MetricCard
                  icon={Truck}
                  label="Clients livres"
                  value={String(route.summary.deliveredCount)}
                />
                <MetricCard
                  icon={Store}
                  label="Magasins avec vente"
                  value={String(route.summary.customersWithSaleCount)}
                />
                <MetricCard
                  icon={ShoppingCart}
                  label="CA"
                  value={formatCurrency(route.summary.salesAmount)}
                  secondary={`${route.summary.salesCount} vente${route.summary.salesCount > 1 ? "s" : ""}`}
                />
              </div>
            ) : (
              <EmptyState message={data.message ?? "Aucun resume disponible."} />
            )}
          </SectionCard>

          <SectionCard
            title="Informations de tournee"
            description="Horaires et statut reels de la fiche journaliere."
          >
            {route ? (
              <div className="space-y-3 text-sm">
                <InfoLine label="Tournee" value={route.tour.code} />
                <InfoLine label="Date" value={formatRouteDay(route.tour.date)} />
                <InfoLine
                  label={<DotLabel color="bg-emerald-600" text="Départ" />}
                  value={formatRouteDateTime(route.summary.startedAt)}
                />
                <InfoLine
                  label={<DotLabel icon={Store} text="Magasins" />}
                  value={`${route.summary.customersWithSaleCount} avec vente`}
                />
                {endpoints?.isFinished ? (
                  <InfoLine
                    label={<DotLabel color="bg-red-600" text="Arrivée" />}
                    value={formatRouteDateTime(endpoints.arrivalAt)}
                  />
                ) : (
                  <>
                    <InfoLine
                      label={<DotLabel color="bg-red-600" text="Arrivée" />}
                      value={route.tour.status === "IN_PROGRESS" ? "Tournée en cours" : "-"}
                    />
                    {endpoints?.lastPosition ? (
                      <InfoLine
                        label={<DotLabel color="bg-blue-600" text="Dernière position" />}
                        value={formatRouteDateTime(endpoints.lastPosition.recordedAt)}
                      />
                    ) : null}
                  </>
                )}
                <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/70 bg-[var(--surface-muted)]/70 px-4 py-3">
                  <span className="text-muted-foreground">Statut</span>
                  <Badge variant={route.tour.status === "IN_PROGRESS" ? "default" : "outline"}>
                    {routeStatusLabel(route.tour.status)}
                  </Badge>
                </div>
              </div>
            ) : (
              <EmptyState message={data.message ?? "Aucune tournee selectionnee."} />
            )}
          </SectionCard>

          <SectionCard
            title="Timeline"
            description="Evenements principaux de la journee: depart, visites et retour."
          >
            {route?.timeline.length ? (
              <div className="space-y-4">
                {route.timeline.map((event) => (
                  <div key={event.id} className="flex gap-3">
                    <div className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
                          {typeof event.commercialStopNumber === "number" ? (
                            <CommercialStopBadge value={event.commercialStopNumber} />
                          ) : null}
                          <span className="truncate">{event.title}</span>
                        </p>
                        <p className="shrink-0 text-xs text-muted-foreground">
                          {formatRouteTime(event.timestamp)}
                        </p>
                      </div>
                      <p className="text-sm text-muted-foreground">{event.subtitle}</p>
                      {typeof event.amount === "number" ? (
                        <p className="mt-1 text-xs font-medium text-emerald-700">
                          {formatCurrency(event.amount)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState message="Aucun evenement a afficher pour cette tournee." />
            )}
          </SectionCard>
        </div>
      </div>

      <SectionCard
        title="Clients visites"
        description="Historique des clients, statuts de visite et ventes associees a la tournee selectionnee."
      >
        {route?.visits.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14 text-right">N°</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Heure</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Première vente</TableHead>
                <TableHead>Vente</TableHead>
                <TableHead className="text-right">Montant</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {route.visits.map((visit) => (
                <TableRow key={visit.customerId}>
                  <TableCell className="text-right">
                    {visit.commercialStopNumber !== null ? (
                      <CommercialStopBadge value={visit.commercialStopNumber} />
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <div className="font-medium text-foreground">{visit.customerName}</div>
                    <div className="text-xs text-muted-foreground">
                      {visit.customerCode}
                      {visit.address ? ` - ${visit.address}` : ""}
                    </div>
                  </TableCell>
                  <TableCell>{formatOptionalVisitTime(visit)}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(visit.status)}>
                      {statusLabel(visit.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>{visit.firstSaleAt ? formatRouteTime(visit.firstSaleAt) : "-"}</TableCell>
                  <TableCell>{visit.saleLabel ?? "-"}</TableCell>
                  <TableCell className="text-right">
                    {visit.saleAmount > 0 ? formatCurrency(visit.saleAmount) : "-"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState
            message={
              route
                ? "Aucun client visite n'est associe a cette tournee."
                : data.message ?? "Aucun client a afficher."
            }
          />
        )}
      </SectionCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-2">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function ReadOnlyInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-[var(--surface-muted)]/70 px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  secondary,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  secondary?: string;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-[var(--surface-muted)]/70 px-4 py-4">
      <div className="mb-2 flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span className="text-xs uppercase tracking-[0.16em]">{label}</span>
      </div>
      <p className="text-lg font-semibold text-foreground">{value}</p>
      {secondary ? <p className="mt-1 text-xs text-muted-foreground">{secondary}</p> : null}
    </div>
  );
}

/** The commercial stop number of a customer, as a small round badge. */
function CommercialStopBadge({ value }: { value: number }) {
  return (
    <span
      className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 px-1.5 text-xs font-bold tabular-nums text-white"
      aria-label={`Arret commercial n°${value}`}
    >
      {value}
    </span>
  );
}

function DotLabel({
  text,
  color,
  icon: Icon,
}: {
  text: string;
  color?: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      {Icon ? (
        <Icon className="h-3.5 w-3.5" />
      ) : (
        <span className={`h-2.5 w-2.5 rounded-full ${color ?? "bg-muted-foreground"}`} aria-hidden="true" />
      )}
      {text}
    </span>
  );
}

function InfoLine({ label, value }: { label: React.ReactNode; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/70 bg-[var(--surface-muted)]/70 px-4 py-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{value}</span>
    </div>
  );
}

function EmptyState({
  message,
  className,
}: {
  message: string;
  className?: string;
}) {
  return (
    <div
      className={[
        "rounded-[22px] border border-dashed border-border bg-[var(--surface-muted)]/50 px-4 py-10 text-center text-sm text-muted-foreground",
        className ?? "",
      ].join(" ")}
    >
      {message}
    </div>
  );
}

function resolveSelectedDriverName(data: TruckRoutesPageData) {
  if (data.filters.driverId) {
    return (
      data.filterOptions.drivers.find((driver) => driver.id === data.filters.driverId)?.label ??
      null
    );
  }

  if (data.filterOptions.tours.length === 1) {
    return data.filterOptions.tours[0]?.driverName ?? null;
  }

  return null;
}

function resolveSelectedTruckLabel(data: TruckRoutesPageData) {
  if (data.filters.truckId) {
    const truck = data.filterOptions.trucks.find((item) => item.id === data.filters.truckId);
    if (truck) {
      return `${truck.label} - ${truck.secondary}`;
    }
  }

  if (data.filterOptions.tours.length === 1) {
    return data.filterOptions.tours[0]?.truckLabel ?? null;
  }

  return null;
}

function formatDuration(value: number | null) {
  if (value === null) {
    return "-";
  }

  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  if (hours === 0) {
    return `${minutes} min`;
  }

  return `${hours}h ${String(minutes).padStart(2, "0")}min`;
}

function formatOptionalVisitTime(visit: TruckRouteVisitDto) {
  const value = visit.arrivedAt ?? visit.completedAt ?? visit.firstDetectedAt;
  return value ? formatRouteTime(value) : "-";
}

function statusLabel(status: TruckRouteVisitDto["status"]) {
  switch (status) {
    case "PENDING":
      return "A visiter";
    case "NEARBY":
      return "Proche";
    case "ARRIVED":
      return "Arrivee";
    case "DELIVERED":
      return "Livre";
    case "NO_SALE":
      return "Sans vente";
    default:
      return status;
  }
}

function statusVariant(status: TruckRouteVisitDto["status"]) {
  switch (status) {
    case "DELIVERED":
      return "default" as const;
    case "NO_SALE":
      return "destructive" as const;
    case "ARRIVED":
      return "secondary" as const;
    default:
      return "outline" as const;
  }
}

function routeStatusLabel(status: string) {
  switch (status) {
    case "DRAFT":
      return "Brouillon";
    case "PREPARED":
      return "Preparee";
    case "LOADED":
      return "Chargee";
    case "IN_PROGRESS":
      return "En cours";
    case "WAITING_FOR_CLOSURE":
      return "En attente de cloture";
    case "CLOSED":
      return "Terminee";
    case "CANCELLED":
      return "Annulee";
    case "INTERRUPTED":
      return "Interrompue";
    default:
      return status;
  }
}
