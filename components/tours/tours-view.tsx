"use client";

import * as React from "react";
import {
  ClipboardList,
  PackageCheck,
  Plus,
  Truck,
  UserRound,
  Warehouse,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  TourDto,
  TourMutationInput,
  TourStockCountMutationInput,
  TruckDto,
} from "@/types/operations-dto";
import type { ProductDto } from "@/types/product-dto";

type ToursViewProps = {
  initialTours: TourDto[];
  trucks: TruckDto[];
  products: ProductDto[];
};

const statusLabels: Record<string, string> = {
  DRAFT: "Brouillon",
  PREPARED: "Preparee",
  LOADED: "Chargee",
  IN_PROGRESS: "En cours",
  WAITING_FOR_CLOSURE: "Retour enregistre",
  CLOSED: "Cloturee",
  CANCELLED: "Annulee",
  INTERRUPTED: "Interrompue",
};

const tourStatusOptions = [
  { value: "all", label: "Tous les statuts" },
  { value: "DRAFT", label: "Brouillon" },
  { value: "PREPARED", label: "Preparee" },
  { value: "LOADED", label: "Chargee" },
  { value: "IN_PROGRESS", label: "En cours" },
  { value: "WAITING_FOR_CLOSURE", label: "Retour enregistre" },
  { value: "CLOSED", label: "Cloturee" },
  { value: "CANCELLED", label: "Annulee" },
  { value: "INTERRUPTED", label: "Interrompue" },
] as const;

type TourStatusFilter = (typeof tourStatusOptions)[number]["value"];

export function ToursView({ initialTours, trucks, products }: ToursViewProps) {
  const [tours, setTours] = React.useState(() => sortTours(initialTours));
  const [trucksState, setTrucksState] = React.useState(trucks);
  const [selectedTourId, setSelectedTourId] = React.useState<string | null>(
    initialTours[0]?.id ?? null,
  );
  const [selectedDate, setSelectedDate] = React.useState(todayDateInput());
  const [selectedTruckId, setSelectedTruckId] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<TourStatusFilter>("all");
  const [lineSearch, setLineSearch] = React.useState("");
  const deferredLineSearch = React.useDeferredValue(lineSearch);
  const [actualInputsByTourId, setActualInputsByTourId] = React.useState<
    Record<string, Record<string, string>>
  >({});
  const [busy, setBusy] = React.useState(false);

  const selectedTruck = React.useMemo(
    () => trucksState.find((truck) => truck.id === selectedTruckId) ?? null,
    [selectedTruckId, trucksState],
  );

  const filteredTours = React.useMemo(
    () =>
      sortTours(
        tours.filter((tour) => {
          const query = normalizeSearch(search);
          const searchable = normalizeSearch(
            `${tour.code} ${tour.truck.code} ${tour.truck.registration} ${tour.driver.name} ${tour.depot.name}`,
          );

          return (
            (!query || searchable.includes(query)) &&
            (statusFilter === "all" || tour.status === statusFilter)
          );
        }),
      ),
    [search, statusFilter, tours],
  );

  const selectedTour =
    tours.find((tour) => tour.id === selectedTourId) ??
    filteredTours[0] ??
    null;

  const currentActualInputs = React.useMemo(
    () => (selectedTour ? actualInputsByTourId[selectedTour.id] ?? {} : {}),
    [actualInputsByTourId, selectedTour],
  );

  const productRows = React.useMemo(() => {
    const normalizedQuery = normalizeSearch(deferredLineSearch);
    const stockSheetByProduct = new Map(
      (selectedTour?.stockSheet?.lines ?? []).map((line) => [line.productId, line]),
    );

    return products
      .map((product) => {
        const stockLine = stockSheetByProduct.get(product.id);
        const actualInput = currentActualInputs[product.id];
        const initialQuantity = stockLine?.initialQuantity ?? 0;
        const loadedQuantity = stockLine?.loadedQuantity ?? 0;
        const reloadedQuantity = stockLine?.reloadedQuantity ?? 0;
        const soldQuantity = stockLine?.soldQuantity ?? 0;
        const theoreticalQuantity = stockLine?.theoreticalQuantity ?? 0;
        const actualQuantity =
          actualInput === undefined
            ? stockLine?.actualQuantity ?? null
            : actualInput === ""
              ? null
              : parseInteger(actualInput, 0);

        return {
          productId: product.id,
          reference: product.reference,
          name: product.name,
          unit: product.unit,
          initialQuantity,
          loadedQuantity,
          reloadedQuantity,
          soldQuantity,
          theoreticalQuantity,
          actualQuantity,
          actualInput:
            actualInput ??
            (stockLine?.actualQuantity !== null && stockLine?.actualQuantity !== undefined
              ? String(stockLine.actualQuantity)
              : ""),
          differenceQuantity:
            actualQuantity === null ? null : actualQuantity - theoreticalQuantity,
          hasActivity:
            initialQuantity > 0 ||
            loadedQuantity > 0 ||
            reloadedQuantity > 0 ||
            soldQuantity > 0 ||
            actualQuantity !== null,
        };
      })
      .filter((row) => {
        if (!normalizedQuery) return true;
        return normalizeSearch(`${row.reference} ${row.name}`).includes(normalizedQuery);
      });
  }, [currentActualInputs, deferredLineSearch, products, selectedTour]);

  const sheetTotals = React.useMemo(
    () =>
      productRows.reduce(
        (totals, row) => {
          totals.initialQuantity += row.initialQuantity;
          totals.loadedQuantity += row.loadedQuantity;
          totals.reloadedQuantity += row.reloadedQuantity;
          totals.soldQuantity += row.soldQuantity;
          totals.theoreticalQuantity += row.theoreticalQuantity;
          if (row.actualQuantity !== null) {
            totals.actualQuantity += row.actualQuantity;
          }
          if (row.differenceQuantity !== null) {
            totals.differenceQuantity += row.differenceQuantity;
          }
          return totals;
        },
        {
          initialQuantity: 0,
          loadedQuantity: 0,
          reloadedQuantity: 0,
          soldQuantity: 0,
          theoreticalQuantity: 0,
          actualQuantity: 0,
          differenceQuantity: 0,
        },
      ),
    [productRows],
  );

  async function refreshTruck(truckId: string) {
    const response = await fetch(`/api/trucks/${truckId}`, { cache: "no-store" });
    const payload = (await response.json()) as { truck?: TruckDto; message?: string };
    if (!response.ok || !payload.truck) return;

    setTrucksState((current) =>
      current.map((truck) => (truck.id === truckId ? (payload.truck as TruckDto) : truck)),
    );
  }

  async function createTour() {
    if (!selectedDate) {
      toast.error("Selectionnez une date.");
      return;
    }
    if (!selectedTruckId) {
      toast.error("Selectionnez un camion.");
      return;
    }

    const values: TourMutationInput = {
      date: selectedDate,
      truckId: selectedTruckId,
    };

    const alreadyExists = tours.some(
      (tour) =>
        tour.truck.id === selectedTruckId && toDateInputValue(tour.date) === selectedDate,
    );

    setBusy(true);
    try {
      const response = await fetch("/api/tours", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const payload = (await response.json()) as { tour?: TourDto; message?: string };
      if (!response.ok || !payload.tour) {
        toast.error(payload.message ?? "Impossible de creer la fiche journaliere.");
        return;
      }

      setTours((current) => upsertTour(current, payload.tour as TourDto));
      setSelectedTourId(payload.tour.id);
      await refreshTruck(payload.tour.truck.id);
      toast.success(
        alreadyExists
          ? "La fiche journaliere existante a ete reouverte."
          : "Fiche journaliere creee.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveActualCounts(tour: TourDto) {
    const payload: TourStockCountMutationInput = {
      lines: productRows
        .filter((row) => row.actualInput !== "")
        .map((row) => ({
          productId: row.productId,
          actualQuantity: parseInteger(row.actualInput, 0),
        })),
    };

    setBusy(true);
    try {
      const response = await fetch(`/api/tours/${tour.id}/counts`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as { tour?: TourDto; message?: string };
      if (!response.ok || !body.tour) {
        toast.error(body.message ?? "Impossible d'enregistrer le stock reel.");
        return;
      }

      setTours((current) => upsertTour(current, body.tour as TourDto));
      await refreshTruck(tour.truck.id);
      toast.success("Stock reel enregistre.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelSelectedTour(tour: TourDto) {
    setBusy(true);
    try {
      const response = await fetch(`/api/tours/${tour.id}/cancel`, { method: "POST" });
      const payload = (await response.json()) as { tour?: TourDto; message?: string };
      if (!response.ok || !payload.tour) {
        toast.error(payload.message ?? "Impossible d'annuler la fiche journaliere.");
        return;
      }

      setTours((current) => upsertTour(current, payload.tour as TourDto));
      toast.success("Fiche journaliere annulee.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Tournees
        </h1>
        <p className="text-sm text-muted-foreground">
          Fiches journalieres de stock, comptage reel et ecarts par camion.
        </p>
      </div>

      <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
        <CardContent className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[180px_1fr_220px]">
            <Field label="Date">
              <Input
                type="date"
                value={selectedDate}
                onChange={(event) => setSelectedDate(event.target.value)}
              />
            </Field>
            <Field label="Camion">
              <NativeSelect
                value={selectedTruckId}
                onChange={(event) => setSelectedTruckId(event.target.value)}
              >
                <option value="">Selectionner</option>
                {trucksState.map((truck) => (
                  <option key={truck.id} value={truck.id}>
                    {truck.code} - {truck.registration}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <div className="flex items-end">
              <Button type="button" disabled={busy} className="h-10 w-full" onClick={createTour}>
                <Plus className="h-4 w-4" />
                Nouvelle fiche journaliere
              </Button>
            </div>
          </div>

          {selectedTruck ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <InfoCard
                icon={Warehouse}
                label="Depot de rattachement"
                value={selectedTruck.depot.name}
              />
              <InfoCard
                icon={UserRound}
                label="Chauffeur affecte"
                value={
                  selectedTruck.assignedDriver?.name ??
                  selectedTruck.defaultDriver?.name ??
                  "Non affecte"
                }
              />
              <InfoCard
                icon={Truck}
                label="Immatriculation"
                value={selectedTruck.registration}
              />
              <InfoCard
                icon={ClipboardList}
                label="Statut du camion"
                value={statusLabelForTruck(selectedTruck.status)}
              />
              <InfoCard
                icon={PackageCheck}
                label="Stock actuel du camion"
                value={formatTruckStock(selectedTruck)}
              />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.25fr]">
        <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <ClipboardList className="h-5 w-5 text-emerald-700" />
              <h2 className="font-heading text-lg font-semibold">
                Fiches journalieres
              </h2>
            </div>

            <div className="grid gap-3 rounded-2xl border border-border bg-muted/20 p-4 lg:grid-cols-[1fr_220px]">
              <Field label="Recherche">
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Code, camion, chauffeur, depot..."
                />
              </Field>
              <Field label="Statut">
                <NativeSelect
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(event.target.value as TourStatusFilter)
                  }
                >
                  {tourStatusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>

            <p className="text-sm text-muted-foreground">
              {filteredTours.length} fiche{filteredTours.length > 1 ? "s" : ""} affichee
              {filteredTours.length > 1 ? "s" : ""} sur {tours.length}.
            </p>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Camion</TableHead>
                  <TableHead>Depot</TableHead>
                  <TableHead>Chauffeur</TableHead>
                  <TableHead>Statut</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTours.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      Aucune fiche journaliere ne correspond aux filtres.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredTours.map((tour) => (
                    <TableRow
                      key={tour.id}
                      className="cursor-pointer"
                      onClick={() => setSelectedTourId(tour.id)}
                    >
                      <TableCell>
                        <div className="font-medium">
                          {new Date(tour.date).toLocaleDateString("fr-FR")}
                        </div>
                        <div className="text-xs text-muted-foreground">{tour.code}</div>
                      </TableCell>
                      <TableCell>
                        <div>{tour.truck.code}</div>
                        <div className="text-xs text-muted-foreground">
                          {tour.truck.registration}
                        </div>
                      </TableCell>
                      <TableCell>{tour.depot.name}</TableCell>
                      <TableCell>{tour.driver.name}</TableCell>
                      <TableCell>
                        <StatusBadge status={tour.status} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
          <CardContent className="space-y-5">
            {selectedTour ? (
              <>
                <div className="space-y-1">
                  <h2 className="font-heading text-lg font-semibold">
                    {selectedTour.code}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {new Date(selectedTour.date).toLocaleDateString("fr-FR")} -{" "}
                    {selectedTour.truck.code} - {selectedTour.depot.name} -{" "}
                    {selectedTour.driver.name}
                  </p>
                </div>

                <div className="grid gap-3 md:grid-cols-4">
                  <MetricCard label="Stock initial" value={sheetTotals.initialQuantity} />
                  <MetricCard label="Theorique" value={sheetTotals.theoreticalQuantity} />
                  <MetricCard label="Reel" value={sheetTotals.actualQuantity} />
                  <MetricCard
                    label="Ecart"
                    value={sheetTotals.differenceQuantity}
                    tone={sheetTotals.differenceQuantity === 0 ? "neutral" : "alert"}
                  />
                </div>

                <Field label="Recherche produit">
                  <Input
                    value={lineSearch}
                    onChange={(event) => setLineSearch(event.target.value)}
                    placeholder="Nom ou reference produit..."
                  />
                </Field>

                <div className="overflow-x-auto rounded-2xl border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Produit</TableHead>
                        <TableHead className="text-right">Initial</TableHead>
                        <TableHead className="text-right">Charge</TableHead>
                        <TableHead className="text-right">Recharge</TableHead>
                        <TableHead className="text-right">Vendu</TableHead>
                        <TableHead className="text-right">Theorique</TableHead>
                        <TableHead className="text-right">Reel</TableHead>
                        <TableHead className="text-right">Ecart</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {productRows.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={8}
                            className="py-8 text-center text-muted-foreground"
                          >
                            Aucun produit ne correspond a la recherche.
                          </TableCell>
                        </TableRow>
                      ) : (
                        productRows.map((row) => (
                          <TableRow key={row.productId}>
                            <TableCell>
                              <div className="font-medium">{row.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {row.reference} - {row.unit}
                              </div>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {row.initialQuantity}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {row.loadedQuantity}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {row.reloadedQuantity}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {row.soldQuantity}
                            </TableCell>
                            <TableCell className="text-right font-medium tabular-nums">
                              {row.theoreticalQuantity}
                            </TableCell>
                            <TableCell className="w-[120px]">
                              <Input
                                type="number"
                                min={0}
                                value={row.actualInput}
                                disabled={busy}
                                onChange={(event) =>
                                  setActualInputsByTourId((current) => ({
                                    ...current,
                                    [selectedTour.id]: {
                                      ...(current[selectedTour.id] ?? {}),
                                      [row.productId]: event.target.value,
                                    },
                                  }))
                                }
                              />
                            </TableCell>
                            <TableCell className="text-right font-medium tabular-nums">
                              {row.differenceQuantity ?? "-"}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => saveActualCounts(selectedTour)}
                  >
                    <PackageCheck className="h-4 w-4" />
                    Enregistrer le stock reel
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={
                      busy ||
                      ["IN_PROGRESS", "WAITING_FOR_CLOSURE", "CLOSED"].includes(
                        selectedTour.status,
                      )
                    }
                    onClick={() => cancelSelectedTour(selectedTour)}
                  >
                    Annuler la fiche
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Aucune fiche journaliere disponible.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function NativeSelect(props: React.ComponentProps<"select">) {
  return (
    <select
      {...props}
      className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-3 focus:ring-emerald-500/15"
    />
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant = status === "CANCELLED" ? "destructive" : "secondary";
  return <Badge variant={variant}>{statusLabels[status] ?? status}</Badge>;
}

function InfoCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-border p-4">
      <div className="flex items-center gap-2 text-emerald-700">
        <Icon className="h-4 w-4" />
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
      <p className="mt-2 text-sm font-medium">{value}</p>
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "alert";
}) {
  return (
    <div className="rounded-2xl border border-border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`mt-2 text-xl font-semibold tabular-nums ${
          tone === "alert" ? "text-amber-700" : "text-foreground"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function statusLabelForTruck(status: string) {
  const labels: Record<string, string> = {
    AVAILABLE: "Disponible",
    LOADING: "En chargement",
    ON_TOUR: "En tournee",
    MAINTENANCE: "Maintenance",
    INACTIVE: "Inactif",
  };
  return labels[status] ?? status;
}

function formatTruckStock(truck: TruckDto) {
  const totalQuantity = truck.stockSummary?.totalQuantity ?? 0;
  const productCount = truck.stockSummary?.productCount ?? 0;
  return `${totalQuantity} unites / ${productCount} produits`;
}

function todayDateInput() {
  return new Date().toISOString().slice(0, 10);
}

function toDateInputValue(value: string) {
  return new Date(value).toISOString().slice(0, 10);
}

function parseInteger(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sortTours(tours: TourDto[]) {
  return [...tours].sort((a, b) => {
    return (
      new Date(b.date).getTime() - new Date(a.date).getTime() ||
      b.code.localeCompare(a.code)
    );
  });
}

function upsertTour(tours: TourDto[], tour: TourDto) {
  const nextTours = tours.some((item) => item.id === tour.id)
    ? tours.map((item) => (item.id === tour.id ? tour : item))
    : [tour, ...tours];
  return sortTours(nextTours);
}

function normalizeSearch(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
