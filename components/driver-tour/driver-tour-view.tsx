"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Clock3, MapPin, PackageCheck, ShoppingCart } from "lucide-react";
import { toast } from "sonner";

import { DriverTourHeader } from "@/components/driver-tour/driver-tour-header";
import { SelectedCustomerCard } from "@/components/driver-tour/selected-customer-card";
import { TourMapActions } from "@/components/driver-tour/tour-map-actions";
import { TourCustomersSheet } from "@/components/driver-tour/tour-customers-sheet";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { calculateDistanceMeters as calculateGpsDistanceMeters } from "@/lib/gps/gps-utils";
import {
  detectGpsStops,
  getGpsStopDurationSeconds,
  summarizeDetectedGpsStops,
} from "@/lib/gps/gps-stop-detection";
import { useDriverRuntime } from "@/hooks/use-driver-runtime";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";
import type { GoogleRouteDto } from "@/types/maps";
import type {
  CurrentDriverTourDto,
  DriverTourCustomerDto,
  DriverTourStopDto,
} from "@/types/operations-dto";

const DriverTourMap = dynamic(
  () =>
    import("./driver-tour-map").then((module) => ({
      default: module.DriverTourMap,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="h-full min-h-[70svh] bg-[linear-gradient(180deg,#f8fafc_0%,#eff6ff_100%)]" />
    ),
  },
);

const STOP_DETECTION_REFRESH_MS = 15_000;

export function DriverTourView({ currentTour }: { currentTour: CurrentDriverTourDto }) {
  const router = useRouter();
  const {
    currentTour: runtimeCurrentTour,
    gps,
    nearbyCustomer,
    hydrateCurrentTour,
    markCustomerHandled,
    refreshCurrentTour,
    replaceCurrentTour,
  } = useDriverRuntime();
  const [returnedTourState, setReturnedTourState] =
    React.useState<CurrentDriverTourDto | null>(null);
  const [customersSheetOpen, setCustomersSheetOpen] = React.useState(false);
  const [userSelectedCustomerId, setUserSelectedCustomerId] = React.useState<string | null>(
    null,
  );
  const [startingTour, setStartingTour] = React.useState(false);
  const [endingTour, setEndingTour] = React.useState(false);
  const [recommendedRouteState, setRecommendedRouteState] = React.useState<{
    customerId: string;
    route: GoogleRouteDto;
  } | null>(null);
  const [routeLoading, setRouteLoading] = React.useState(false);
  const [noSaleLoading, setNoSaleLoading] = React.useState(false);
  const [showStartConfirmation, setShowStartConfirmation] = React.useState(false);
  const [showReturnConfirmation, setShowReturnConfirmation] = React.useState(false);
  const [clockNow, setClockNow] = React.useState(() => Date.now());
  const startingTourRef = React.useRef(false);

  React.useEffect(() => {
    hydrateCurrentTour(currentTour);
  }, [currentTour, hydrateCurrentTour]);

  const state = React.useMemo(
    () => resolveDisplayedTourState(currentTour, runtimeCurrentTour, returnedTourState),
    [currentTour, returnedTourState, runtimeCurrentTour],
  );

  const tour = state.tour;
  const inProgress = tour?.status === "IN_PROGRESS";
  const finishedTour = Boolean(tour && tour.status !== "IN_PROGRESS" && !state.canStart);

  // The map marker always renders the last known position, regardless of how
  // stale or momentarily imprecise it is (see hooks/use-driver-geolocation.ts)
  // — GPS going quiet must never move or hide the truck. Distance/proximity
  // calculations below intentionally keep using the stricter, freshness-gated
  // reliablePosition instead.
  const mapMarkerPosition = gps.lastKnownPosition ?? state.latestPosition ?? null;
  const currentPosition = gps.reliablePosition;
  const gpsStatus = gps.status;
  const tourId = tour?.id ?? null;
  const stopDetectionNow =
    Math.floor(clockNow / STOP_DETECTION_REFRESH_MS) * STOP_DETECTION_REFRESH_MS;

  const stops = React.useMemo(
    () =>
      state.route.length > 0
        ? detectGpsStops(state.route, { now: stopDetectionNow })
        : state.stops,
    [state.route, state.stops, stopDetectionNow],
  );
  const stopSummary = React.useMemo(
    () => summarizeDetectedGpsStops(stops, clockNow),
    [clockNow, stops],
  );

  React.useEffect(() => {
    if (!tourId || (state.route.length === 0 && state.stops.length === 0)) {
      return;
    }

    const intervalId = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [state.route.length, state.stops.length, tourId]);

  const customers = React.useMemo(
    () =>
      state.customers.map((customer) => ({
        ...customer,
        distanceMeters:
          currentPosition &&
          customer.latitude !== null &&
          customer.latitude !== undefined &&
          customer.longitude !== null &&
          customer.longitude !== undefined
              ? calculateGpsDistanceMeters(currentPosition, {
                  latitude: customer.latitude,
                  longitude: customer.longitude,
                })
            : null,
      })),
    [currentPosition, state.customers],
  );

  const suggestedCustomer = React.useMemo(
    () => resolveNearbySuggestedCustomer(customers, nearbyCustomer),
    [customers, nearbyCustomer],
  );

  const selectedCustomer = React.useMemo(
    () => resolveSelectedCustomer(customers, userSelectedCustomerId),
    [customers, userSelectedCustomerId],
  );

  const recommendedRoute =
    recommendedRouteState && recommendedRouteState.customerId === selectedCustomer?.id
      ? recommendedRouteState.route
      : null;

  const completedCount = customers.filter(
    (customer) =>
      customer.visitStatus === "DELIVERED" || customer.visitStatus === "NO_SALE",
  ).length;
  const remainingCustomersCount = Math.max(0, customers.length - completedCount);

  async function refreshTour(options?: { syncLocalState?: boolean }) {
    const nextTour = await refreshCurrentTour();
    return options?.syncLocalState === false
      ? nextTour
      : syncDriverTourState(state, nextTour);
  }

  function resetTourUi(nextTour: CurrentDriverTourDto) {
    setReturnedTourState(null);
    replaceCurrentTour(nextTour);
    setUserSelectedCustomerId(null);
    if (nextTour.latestPosition) {
      gps.reset(nextTour.latestPosition);
    }
    setShowStartConfirmation(false);
    setShowReturnConfirmation(false);
  }

  async function startNewTour() {
    if (startingTourRef.current) {
      return;
    }

    startingTourRef.current = true;
    setStartingTour(true);

    try {
      const response = await fetch("/api/driver/tour/start", { method: "POST" });
      const payload = (await response.json()) as {
        tour?: unknown;
        message?: string;
      };

      if (!response.ok) {
        toast.error(payload.message ?? "Impossible de demarrer la tournee.");
        return;
      }

      resetTourUi(await refreshTour());
      gps.retry();
      toast.success("Tournee demarree. Le GPS peut maintenant envoyer vos positions.");
    } catch {
      toast.error("Impossible de demarrer la tournee.");
    } finally {
      startingTourRef.current = false;
      setStartingTour(false);
    }
  }

  async function confirmReturnTour() {
    if (endingTour) {
      return;
    }

    setEndingTour(true);

    try {
      const response = await fetch("/api/driver/tour/return", { method: "POST" });
      const payload = (await response.json()) as {
        tour?: unknown;
        message?: string;
      };

      if (!response.ok) {
        toast.error(payload.message ?? "Impossible de terminer la tournee.");
        return;
      }

      const refreshedTour = await refreshTour({ syncLocalState: false });
      if (refreshedTour.tour) {
        resetTourUi(refreshedTour);
      } else {
        setReturnedTourState(buildReturnedTourState(state, refreshedTour));
        setUserSelectedCustomerId(null);
        setShowReturnConfirmation(false);
      }
      toast.success("Tournee terminee. Les suggestions de client proche restent actives.");
    } catch {
      toast.error("Impossible de terminer la tournee.");
    } finally {
      setEndingTour(false);
    }
  }

  function openPos(customerId?: string) {
    const target = customerId
      ? `/driver/pos?customerId=${encodeURIComponent(customerId)}`
      : "/driver/pos";
    router.push(target);
  }

  async function calculateItinerary(customer: DriverTourCustomerDto | null) {
    if (
      !customer ||
      customer.latitude === null ||
      customer.latitude === undefined ||
      customer.longitude === null ||
      customer.longitude === undefined
    ) {
      toast.error("La localisation de ce client est manquante.");
      return;
    }

    if (!currentPosition) {
      toast.error("Position GPS actuelle indisponible.");
      return;
    }

    setRouteLoading(true);
    try {
      const response = await fetch("/api/maps/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destination: {
            latitude: customer.latitude,
            longitude: customer.longitude,
          },
        }),
      });
      const payload = (await response.json()) as {
        route?: GoogleRouteDto;
        message?: string;
      };

      if (!response.ok || !payload.route) {
        toast.error(payload.message ?? "Impossible de calculer l'itineraire.");
        return;
      }

      setRecommendedRouteState({ customerId: customer.id, route: payload.route });
      toast.success("Itineraire calcule sur la carte.");
    } catch {
      toast.error("Impossible de calculer l'itineraire.");
    } finally {
      setRouteLoading(false);
    }
  }

  async function markNoSale(customerId: string) {
    if (noSaleLoading) {
      return;
    }

    setNoSaleLoading(true);
    try {
      const response = await fetch(
        `/api/driver/tour/customers/${encodeURIComponent(customerId)}/no-sale`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: null }),
        },
      );
      const payload = (await response.json()) as {
        currentTour?: CurrentDriverTourDto;
        message?: string;
      };

      if (!response.ok || !payload.currentTour) {
        toast.error(payload.message ?? "Impossible d'enregistrer l'absence de vente.");
        return;
      }

      setReturnedTourState(null);
      markCustomerHandled(customerId);
      replaceCurrentTour(payload.currentTour);
      toast.success("Client marque sans vente.");
    } catch {
      toast.error("Impossible d'enregistrer l'absence de vente.");
    } finally {
      setNoSaleLoading(false);
    }
  }

  if (!tour) {
    const startContext = state.startContext ?? null;
    const emptyTitle = state.canStart
      ? "Pret a demarrer"
      : state.message.toLowerCase().includes("terminee")
        ? "Tournee terminee"
        : "Aucune tournee active";

    return (
      <div className="min-h-dvh bg-background">
        <DriverTourHeader gpsStatus={gpsStatus} />
        <div className="mx-auto max-w-[720px] px-4 py-8 sm:px-6">
          <div className="rounded-[32px] border border-border/70 bg-background p-6 shadow-[0_20px_48px_rgba(15,23,42,0.08)] sm:p-8">
            <p className="text-[11px] uppercase tracking-[0.26em] text-muted-foreground">
              Ma tournee
            </p>
            <h1 className="mt-3 font-heading text-2xl font-semibold text-foreground">
              {emptyTitle}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">{state.message}</p>

            {startContext ? (
              <div className="mt-6 space-y-5">
                {showStartConfirmation ? (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <StartInfoCard
                        label="Chauffeur"
                        value={startContext.driver.name}
                      />
                      <StartInfoCard
                        label="Camion"
                        value={startContext.truck.code}
                        hint={startContext.truck.registration}
                      />
                      <StartInfoCard
                        label="Date"
                        value={formatFrenchDate(startContext.date)}
                      />
                      <StartInfoCard
                        label="Depot"
                        value={startContext.depot?.name ?? "-"}
                        hint={startContext.depot?.code ?? undefined}
                      />
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <MetricRow
                        icon={PackageCheck}
                        label="Stock camion"
                        value={String(startContext.stockCurrentQuantity)}
                      />
                      <MetricRow
                        icon={ShoppingCart}
                        label="Produits en stock"
                        value={String(startContext.productCount)}
                      />
                    </div>

                    {startContext.warning ? (
                      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                        {startContext.warning}
                      </div>
                    ) : null}

                    <div className="flex flex-col gap-3 sm:flex-row">
                      {state.canStart ? (
                        <button
                          type="button"
                          onClick={startNewTour}
                          disabled={startingTour}
                          className="inline-flex h-12 items-center justify-center rounded-2xl bg-foreground px-5 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {startingTour ? "Demarrage..." : "Commencer la tournee"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setShowStartConfirmation(false)}
                        disabled={startingTour}
                        className="inline-flex h-12 items-center justify-center rounded-2xl border border-border bg-background px-5 text-sm font-medium text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Annuler
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col gap-3 sm:flex-row">
                    {state.canStart ? (
                      <button
                        type="button"
                        onClick={() => setShowStartConfirmation(true)}
                        className="inline-flex h-12 items-center justify-center rounded-2xl bg-foreground px-5 text-sm font-medium text-background transition hover:opacity-90"
                      >
                        Commencer la tournee
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-6">
                <EmptyTourState title="Ma tournee" message={state.message} />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-background">
      <DriverTourHeader
        driverName={tour.driver.name}
        truckCode={tour.truck.code}
        gpsStatus={gpsStatus}
      />

      <div className="mx-auto max-w-[1120px]">
        <section className="relative overflow-hidden bg-background">
          <div className="relative h-[calc(100dvh-54px)] min-h-[620px] lg:h-[calc(100dvh-32px)]">
            <div className="absolute inset-0">
              <DriverTourMap
                customers={customers}
                route={state.route}
                stops={stops}
                recommendedRoute={recommendedRoute?.polyline ?? []}
                currentPosition={mapMarkerPosition}
                suggestedCustomerId={suggestedCustomer?.id ?? null}
                selectedCustomerId={selectedCustomer?.id ?? null}
                gpsActive={inProgress}
                onSelectCustomer={setUserSelectedCustomerId}
                onCreateSale={openPos}
              />
            </div>

            <div className="pointer-events-none absolute left-3 right-3 top-3 z-[600] flex justify-between gap-3 sm:left-4 sm:right-4">
              <div className="pointer-events-auto rounded-full bg-background/92 px-3 py-2 text-xs text-muted-foreground shadow-sm backdrop-blur">
                {completedCount}/{state.customers.length || 0} clients •{" "}
                {formatCurrency(state.summary?.totalSalesTTC ?? 0)}
              </div>
              {selectedCustomer ? (
                <div className="pointer-events-auto rounded-full bg-background/92 px-3 py-2 text-xs text-muted-foreground shadow-sm backdrop-blur">
                  {visitLabel(selectedCustomer)}
                </div>
              ) : suggestedCustomer ? (
                <div className="pointer-events-auto rounded-full bg-background/92 px-3 py-2 text-xs text-muted-foreground shadow-sm backdrop-blur">
                  Suggestion: {suggestedCustomer.name}
                </div>
              ) : null}
            </div>

            <div className="pointer-events-none absolute inset-x-4 bottom-3 z-[650] flex flex-col-reverse gap-2 sm:bottom-4">
              <div className="pointer-events-auto flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                <div className="order-2 md:order-1">
                  {!selectedCustomer ? (
                    <Button
                      type="button"
                      className="h-11 rounded-2xl shadow-[0_14px_34px_rgba(15,23,42,0.18)]"
                      onClick={() => setCustomersSheetOpen(true)}
                    >
                      Choisir un client
                    </Button>
                  ) : null}
                </div>

                <div className="order-1 self-end md:order-2">
                  <TourMapActions
                    completedCount={completedCount}
                    totalCount={customers.length}
                    salesCount={state.summary?.salesCount ?? 0}
                    totalSalesTTC={state.summary?.totalSalesTTC ?? 0}
                    canStart={state.canStart}
                    startButtonLabel={startingTour ? "Demarrage..." : "Commencer"}
                    startButtonDisabled={startingTour}
                    canReturn={state.canReturn}
                    returnButtonLabel={endingTour ? "Cloture..." : "Terminer"}
                    returnButtonDisabled={endingTour}
                    onOpenCustomers={() => setCustomersSheetOpen(true)}
                    onStartTour={startNewTour}
                    onReturnTour={() => setShowReturnConfirmation(true)}
                    formatAmount={formatCurrency}
                  />
                </div>
              </div>

              {selectedCustomer ? (
                <div className="pointer-events-auto flex justify-center">
                  <div className="w-full sm:max-w-[500px]">
                    <SelectedCustomerCard
                      customer={selectedCustomer}
                      inProgress={inProgress}
                      canOpenItinerary={
                        Boolean(currentPosition) && hasCustomerLocation(selectedCustomer)
                      }
                      routeLoading={routeLoading}
                      routeSummary={recommendedRoute}
                      noSaleLoading={noSaleLoading}
                      onClose={() => setUserSelectedCustomerId(null)}
                      onCreateSale={() => openPos(selectedCustomer.id)}
                      onOpenItinerary={() => calculateItinerary(selectedCustomer)}
                      onMarkNoSale={() => markNoSale(selectedCustomer.id)}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        {tour ? (
          <div className="px-4 py-4 sm:px-6">
            <Card className="rounded-[28px] border-0 shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
              <CardContent className="space-y-4 p-4">
                <SectionHeader
                  title="Arrets de la tournee"
                  description="Detectes automatiquement a partir des positions GPS reelles du camion."
                />

                <div className="grid gap-3 sm:grid-cols-2">
                  <MetricRow
                    icon={MapPin}
                    label="Nombre d'arrets"
                    value={String(stopSummary.count)}
                  />
                  <MetricRow
                    icon={Clock3}
                    label="Temps a l'arret"
                    value={formatStopDuration(stopSummary.totalDurationSeconds)}
                  />
                </div>

                {stops.length > 0 ? (
                  <div className="space-y-3">
                    {stops.map((stop, index) => {
                      const durationSeconds = getGpsStopDurationSeconds(stop, clockNow);

                      return (
                        <div
                          key={stop.id}
                          className="rounded-[22px] border border-border/70 bg-muted/20 px-4 py-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-foreground">
                                Arret {index + 1}
                              </p>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {formatStopRange(stop, clockNow)}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-semibold text-foreground">
                                {formatStopDuration(durationSeconds)}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {stop.isActive ? "En cours" : "Termine"}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyTourState
                    title="Aucun arret detecte"
                    message="Les arrets apparaitront ici lorsqu'un groupe de points GPS restera dans une meme zone assez longtemps."
                  />
                )}
              </CardContent>
            </Card>
          </div>
        ) : null}

        {finishedTour ? (
          <div className="space-y-4 px-4 py-4 sm:px-6">
            <Card className="rounded-[28px] border-0 shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
              <CardContent className="space-y-4 p-4">
                <SectionHeader
                  title="Tournee terminee"
                  description="Affiche uniquement apres la fin de la tournee."
                />

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <MetricRow
                    icon={Clock3}
                    label="Depart"
                    value={formatTime(tour.startedAt)}
                  />
                  <MetricRow
                    icon={Clock3}
                    label="Fin"
                    value={formatTime(tour.returnedAt)}
                  />
                  <MetricRow
                    icon={MapPin}
                    label="Distance"
                    value={formatDistance(state.summary?.distanceMeters ?? 0)}
                  />
                  <MetricRow
                    icon={ShoppingCart}
                    label="Ventes"
                    value={String(state.summary?.salesCount ?? 0)}
                  />
                  <MetricRow
                    icon={ShoppingCart}
                    label="Montant"
                    value={formatCurrency(state.summary?.totalSalesTTC ?? 0)}
                  />
                  <MetricRow
                    icon={Clock3}
                    label="Clients"
                    value={`${completedCount}/${customers.length || 0}`}
                  />
                  <MetricRow
                    icon={Clock3}
                    label="Sans vente"
                    value={String(state.summary?.customersNoSale ?? 0)}
                  />
                  <MetricRow
                    icon={PackageCheck}
                    label="Stock"
                    value={String(state.summary?.stockCurrentQuantity ?? 0)}
                  />
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button
                    type="button"
                    className="h-12 rounded-2xl"
                    onClick={startNewTour}
                    disabled={startingTour}
                  >
                    {startingTour ? "Demarrage..." : "Commencer une nouvelle tournee"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-[28px] border-0 shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
              <CardContent className="space-y-4 p-4">
                <SectionHeader
                  title="Stock charge"
                  description="Etat theorique et reel apres la tournee."
                />

                {!tour.loading || tour.loading.status !== "VALIDATED" ? (
                  <EmptyTourState
                    title="Chargement non valide"
                    message="La tournee ne peut pas afficher un recapitulatif complet sans chargement valide."
                  />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Produit</TableHead>
                        <TableHead className="text-right">Charge</TableHead>
                        <TableHead className="text-right">Vendu</TableHead>
                        <TableHead className="text-right">Theorique</TableHead>
                        <TableHead className="text-right">Reel</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tour.stockSheet?.lines.length ? (
                        tour.stockSheet.lines.map((line) => (
                          <TableRow key={line.productId}>
                            <TableCell>
                              <div className="font-medium">{line.productName}</div>
                              <div className="text-xs text-muted-foreground">
                                {line.productReference}
                              </div>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {line.loadedQuantity + line.reloadedQuantity}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {line.soldQuantity}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {line.theoreticalQuantity}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {line.actualQuantity ?? "-"}
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell
                            colSpan={5}
                            className="py-8 text-center text-sm text-muted-foreground"
                          >
                            Aucun mouvement de stock enregistre pour cette tournee.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        ) : null}
      </div>

      <TourCustomersSheet
        open={customersSheetOpen}
        customers={customers}
        selectedCustomerId={selectedCustomer?.id ?? null}
        suggestedCustomerId={suggestedCustomer?.id ?? null}
        completedCount={completedCount}
        onClose={() => setCustomersSheetOpen(false)}
        onSelectCustomer={setUserSelectedCustomerId}
      />

      <Dialog open={showReturnConfirmation} onOpenChange={setShowReturnConfirmation}>
        <DialogContent className="max-w-[calc(100%-1rem)] sm:max-w-lg" showCloseButton={!endingTour}>
          <DialogHeader>
            <DialogTitle>Terminer la tournee ?</DialogTitle>
            <DialogDescription>
              Cette action va cloturer la tournee en cours.
              {remainingCustomersCount > 0
                ? ` ${remainingCustomersCount} client${remainingCustomersCount > 1 ? "s" : ""} n'ont pas encore ete visite${remainingCustomersCount > 1 ? "s" : ""}.`
                : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <StartInfoCard label="Chauffeur" value={tour?.driver.name ?? "-"} />
            <StartInfoCard
              label="Camion"
              value={tour?.truck.code ?? "-"}
              hint={tour?.truck.registration ?? undefined}
            />
            <StartInfoCard
              label="Ventes"
              value={String(state.summary?.salesCount ?? 0)}
              hint={formatCurrency(state.summary?.totalSalesTTC ?? 0)}
            />
            <StartInfoCard
              label="Clients"
              value={`${completedCount}/${customers.length || 0}`}
              hint={
                remainingCustomersCount > 0
                  ? `${remainingCustomersCount} non visite${remainingCustomersCount > 1 ? "s" : ""}`
                  : "Tous les clients ont ete traites"
              }
            />
            <StartInfoCard
              label="Stock camion"
              value={String(state.summary?.stockCurrentQuantity ?? 0)}
            />
            <StartInfoCard
              label="GPS"
              value={gpsStatus === "ACTIVE" ? "Actif" : gpsStatus === "SLOW" ? "Lent" : "Inactif"}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowReturnConfirmation(false)}
              disabled={endingTour}
            >
              Annuler
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmReturnTour}
              disabled={endingTour}
            >
              {endingTour ? "Cloture en cours..." : "Terminer la tournee"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="font-heading text-lg font-semibold text-foreground">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function MetricRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl bg-muted/40 px-3 py-3">
      <div className="mb-2 flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span className="text-xs uppercase tracking-[0.18em]">{label}</span>
      </div>
      <p className="text-base font-semibold text-foreground">{value}</p>
    </div>
  );
}

function EmptyTourState({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-[24px] border border-dashed border-border bg-muted/20 p-8 text-center">
      <p className="font-medium text-foreground">{title}</p>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function StartInfoCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl bg-muted/35 px-4 py-4">
      <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-base font-semibold text-foreground">{value}</p>
      {hint ? <p className="mt-1 text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function resolveNearbySuggestedCustomer(
  customers: DriverTourCustomerDto[],
  nearbyCustomer:
    | {
        customer: { id: string };
        distanceMeters: number;
      }
    | null,
) {
  if (!nearbyCustomer) {
    return null;
  }

  const matchedCustomer = customers.find(
    (customer) => customer.id === nearbyCustomer.customer.id,
  );
  if (!matchedCustomer) {
    return null;
  }

  return {
    ...matchedCustomer,
    distanceMeters: nearbyCustomer.distanceMeters,
  };
}

function resolveSelectedCustomer(
  customers: DriverTourCustomerDto[],
  selectedCustomerId: string | null,
) {
  if (!selectedCustomerId) {
    return null;
  }

  return customers.find((customer) => customer.id === selectedCustomerId) ?? null;
}

function visitLabel(customer: DriverTourCustomerDto) {
  switch (customer.visitStatus) {
    case "PENDING":
      return "A visiter";
    case "NEARBY":
      return "Client proche";
    case "ARRIVED":
      return "Arrivee confirmee";
    case "DELIVERED":
      return "Client livre";
    case "NO_SALE":
      return "Sans achat";
    default:
      return "Client";
  }
}

function formatDistance(value: number) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)} km`;
  }

  return `${Math.round(value)} m`;
}

function hasCustomerLocation(customer: DriverTourCustomerDto) {
  return (
    customer.latitude !== null &&
    customer.latitude !== undefined &&
    customer.longitude !== null &&
    customer.longitude !== undefined
  );
}

function resolveDisplayedTourState(
  initialTour: CurrentDriverTourDto,
  runtimeTour: CurrentDriverTourDto | null,
  returnedTourState: CurrentDriverTourDto | null,
) {
  if (returnedTourState) {
    return returnedTourState;
  }

  if (!runtimeTour) {
    return initialTour;
  }

  const initialTourId = initialTour.tour?.id ?? null;
  const runtimeTourId = runtimeTour.tour?.id ?? null;
  if (initialTourId && !runtimeTourId) {
    return initialTour;
  }

  if (!initialTourId && runtimeTourId) {
    return runtimeTour;
  }

  if (initialTourId !== runtimeTourId) {
    return runtimeTour;
  }

  return runtimeTour;
}

function syncDriverTourState(
  current: CurrentDriverTourDto,
  next: CurrentDriverTourDto,
) {
  if (
    current.tour &&
    !next.tour &&
    (current.tour.status === "WAITING_FOR_CLOSURE" || current.tour.status === "CLOSED")
  ) {
    return current;
  }

  return next;
}

function buildReturnedTourState(
  current: CurrentDriverTourDto,
  fallback: CurrentDriverTourDto,
) {
  if (!current.tour) {
    return fallback;
  }

  return {
    ...current,
    tour: {
      ...current.tour,
      status: "WAITING_FOR_CLOSURE",
      returnedAt: new Date().toISOString(),
    },
    canReturn: false,
    canStart: false,
    message: "Tournee terminee",
  };
}


function formatFrenchDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function formatTime(value?: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatStopRange(stop: DriverTourStopDto, now: number) {
  const start = formatTime(stop.startedAt);
  const end = stop.isActive ? "maintenant" : formatTime(stop.endedAt);
  const duration = formatStopDuration(getGpsStopDurationSeconds(stop, now));
  return `${start} -> ${end} • ${duration}`;
}

function formatStopDuration(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return minutes > 0 ? `${hours} h ${minutes.toString().padStart(2, "0")} min` : `${hours} h`;
  }

  if (minutes > 0) {
    return seconds > 0 ? `${minutes} min ${seconds} sec` : `${minutes} min`;
  }

  return `${seconds} sec`;
}
