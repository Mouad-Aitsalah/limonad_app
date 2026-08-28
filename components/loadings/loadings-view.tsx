"use client";

import * as React from "react";
import Link from "next/link";
import {
  ClipboardList,
  Lock,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  Truck,
  UserRound,
  Warehouse,
  X,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  DriverAssignmentDto,
  StockLevelDto,
  TruckDto,
  TruckLoadingDto,
} from "@/types/operations-dto";
import type { ProductDto } from "@/types/product-dto";

type LoadingsViewProps = {
  trucks: TruckDto[];
  drivers: DriverAssignmentDto[];
  products: ProductDto[];
  history: TruckLoadingDto[];
};

const loadingStatusLabels: Record<string, string> = {
  DRAFT: "Ouvert",
  VALIDATED: "Ferme",
  CANCELLED: "Annule",
};

type DraftLoadingLine = {
  productId: string;
  productName: string;
  productReference: string;
  productBarcode?: string | null;
  productUnit: string;
  depotAvailableQuantity: number;
  initialLoadQuantity: number;
  reloadedQuantity: number;
  actualRemainingQuantity: number | null;
};

type ProductSuggestion = {
  product: ProductDto;
  truckCurrentQuantity: number;
  depotAvailableQuantity: number;
};

export function LoadingsView({ trucks, drivers, products, history }: LoadingsViewProps) {
  const [activeTab, setActiveTab] = React.useState("loading");
  const [trucksState] = React.useState(trucks);
  const [selectedDate, setSelectedDate] = React.useState(todayDateInput());
  const [selectedDriverId, setSelectedDriverId] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const [rawOpenLoading, setRawOpenLoading] = React.useState<TruckLoadingDto | null>(null);
  const [loadedForTruckId, setLoadedForTruckId] = React.useState<string | null>(null);
  const [draftLines, setDraftLines] = React.useState<DraftLoadingLine[]>([]);
  const [draftSyncKeyState, setDraftSyncKey] = React.useState<string | null>(null);

  const [historyState, setHistoryState] = React.useState(history);
  const [historySearch, setHistorySearch] = React.useState("");

  const [productSearch, setProductSearch] = React.useState("");
  const [selectedProduct, setSelectedProduct] = React.useState<ProductSuggestion | null>(null);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = React.useState(0);
  const [suggestionsOpen, setSuggestionsOpen] = React.useState(false);
  const deferredProductSearch = React.useDeferredValue(productSearch);

  const [initialLoadInput, setInitialLoadInput] = React.useState("0");
  const [reloadedInput, setReloadedInput] = React.useState("0");
  const [actualRemainingInput, setActualRemainingInput] = React.useState("");

  const [truckLevelsByProductId, setTruckLevelsByProductId] = React.useState<
    Record<string, number>
  >({});
  const [depotLevelsByProductId, setDepotLevelsByProductId] = React.useState<
    Record<string, number>
  >({});
  const productSearchRef = React.useRef<HTMLInputElement | null>(null);
  const initialLoadRef = React.useRef<HTMLInputElement | null>(null);
  const reloadedRef = React.useRef<HTMLInputElement | null>(null);
  const actualRemainingRef = React.useRef<HTMLInputElement | null>(null);

  const productsById = React.useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );

  const driversState = React.useMemo(
    () =>
      [...drivers].sort((a, b) => {
        return (
          a.user.fullName.localeCompare(b.user.fullName, "fr-FR") ||
          a.employeeCode.localeCompare(b.employeeCode, "fr-FR")
        );
      }),
    [drivers],
  );

  const selectedDriver = React.useMemo(
    () => driversState.find((driver) => driver.id === selectedDriverId) ?? null,
    [driversState, selectedDriverId],
  );

  const selectedTruck = React.useMemo(
    () =>
      selectedDriver?.truckId
        ? trucksState.find((truck) => truck.id === selectedDriver.truckId) ?? null
        : null,
    [selectedDriver, trucksState],
  );

  // Item 10: reprise automatique - resolve the OPEN fiche for the selected
  // truck the moment a truck is selected (page load, driver change, tab
  // return, reload...), no user action required. The effect only performs
  // the async fetch; "no truck selected" is handled by deriving openLoading
  // below instead of resetting state synchronously in the effect body.
  React.useEffect(() => {
    if (!selectedTruck) return;
    let active = true;
    const truckId = selectedTruck.id;

    fetch(`/api/truck-loadings/open?truckId=${truckId}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((body: { loading?: TruckLoadingDto | null }) => {
        if (!active) return;
        setRawOpenLoading(body.loading ?? null);
        setLoadedForTruckId(truckId);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [selectedTruck]);

  const openLoadingLoaded = !selectedTruck || loadedForTruckId === selectedTruck.id;
  const openLoading = openLoadingLoaded ? (selectedTruck ? rawOpenLoading : null) : null;
  const loadingIsLocked = openLoading?.status !== "DRAFT";

  function setOpenLoading(loading: TruckLoadingDto | null) {
    setRawOpenLoading(loading);
    if (selectedTruck) setLoadedForTruckId(selectedTruck.id);
  }

  // draftLines always mirrors the persisted state of the open fiche. Adjusted
  // synchronously during render (React's documented pattern for resetting
  // derived state when its source changes) rather than in an effect.
  const draftSyncKey = openLoading ? `${openLoading.id}:${openLoading.updatedAt}` : null;
  if (draftSyncKey !== draftSyncKeyState) {
    setDraftSyncKey(draftSyncKey);
    setDraftLines(
      openLoading
        ? openLoading.lines.map((line) => {
            const product = productsById.get(line.productId);
            return {
              productId: line.productId,
              productName: line.productName,
              productReference: line.productReference,
              productBarcode: product?.barcode ?? null,
              productUnit: product?.unit ?? "-",
              depotAvailableQuantity: line.depotAvailableQuantity,
              initialLoadQuantity: line.initialQuantity,
              reloadedQuantity: line.reloadedQuantity,
              actualRemainingQuantity: line.actualRemainingQuantity,
            };
          })
        : [],
    );
  }

  React.useEffect(() => {
    if (!selectedTruck) return;
    let active = true;
    const truckId = selectedTruck.id;
    const depotId = selectedTruck.depot.id;

    async function loadStockLevels() {
      const [truckResponse, depotResponse] = await Promise.all([
        fetch(`/api/stock/truck/${truckId}`, { cache: "no-store" }),
        fetch(`/api/stock/depot/${depotId}`, { cache: "no-store" }),
      ]);
      const [truckPayload, depotPayload] = (await Promise.all([
        truckResponse.json(),
        depotResponse.json(),
      ])) as [{ levels?: StockLevelDto[] }, { levels?: StockLevelDto[] }];

      if (!active) return;
      setTruckLevelsByProductId(toQuantityMap(truckPayload.levels ?? []));
      setDepotLevelsByProductId(toAvailableQuantityMap(depotPayload.levels ?? []));
    }

    void loadStockLevels();
    return () => {
      active = false;
    };
  }, [selectedTruck]);

  const productSuggestions = React.useMemo(() => {
    const query = normalizeSearch(deferredProductSearch);
    if (!query || !selectedTruck) return [];

    return products
      .filter((product) => product.status === "ACTIVE")
      .filter((product) => {
        const haystack = normalizeSearch(
          `${product.name} ${product.reference} ${product.barcode ?? ""}`,
        );
        return haystack.includes(query);
      })
      .slice(0, 8)
      .map((product) => ({
        product,
        truckCurrentQuantity: truckLevelsByProductId[product.id] ?? 0,
        depotAvailableQuantity: depotLevelsByProductId[product.id] ?? 0,
      }));
  }, [deferredProductSearch, depotLevelsByProductId, products, selectedTruck, truckLevelsByProductId]);

  const activeProductSuggestionIndex = Math.min(
    activeSuggestionIndex,
    Math.max(productSuggestions.length - 1, 0),
  );

  const draftTotals = React.useMemo(
    () =>
      draftLines.reduce(
        (totals, line) => {
          totals.initialLoadQuantity += line.initialLoadQuantity;
          totals.reloadedQuantity += line.reloadedQuantity;
          totals.actualRemainingQuantity += line.actualRemainingQuantity ?? 0;
          totals.theoreticalRemainingQuantity += truckLevelsByProductId[line.productId] ?? 0;
          return totals;
        },
        {
          initialLoadQuantity: 0,
          reloadedQuantity: 0,
          actualRemainingQuantity: 0,
          theoreticalRemainingQuantity: 0,
        },
      ),
    [draftLines, truckLevelsByProductId],
  );

  const filteredHistory = React.useMemo(() => {
    const query = normalizeSearch(historySearch);
    return [...historyState]
      .filter((loading) => {
        if (!query) return true;
        const haystack = normalizeSearch(
          `${loading.displayNumber} ${loading.driverName} ${loading.truckCode} ${loading.depotName}`,
        );
        return haystack.includes(query);
      })
      .sort((a, b) => {
        return (
          (b.loadingYear ?? 0) - (a.loadingYear ?? 0) ||
          (b.loadingSequence ?? 0) - (a.loadingSequence ?? 0) ||
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      });
  }, [historyState, historySearch]);

  function focusAndSelectInput(ref: React.RefObject<HTMLInputElement | null>) {
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.select();
    });
  }

  function resetQuickEntry() {
    setSelectedProduct(null);
    setProductSearch("");
    setInitialLoadInput("0");
    setReloadedInput("0");
    setActualRemainingInput("");
    setSuggestionsOpen(false);
    setActiveSuggestionIndex(0);
    focusAndSelectInput(productSearchRef);
  }

  function chooseSuggestion(suggestion: ProductSuggestion) {
    const existingLine = draftLines.find((line) => line.productId === suggestion.product.id);

    setSelectedProduct(suggestion);
    setProductSearch(formatSuggestionLabel(suggestion.product));
    setSuggestionsOpen(false);
    setActiveSuggestionIndex(0);
    setInitialLoadInput(String(existingLine?.initialLoadQuantity ?? 0));
    setReloadedInput(String(existingLine?.reloadedQuantity ?? 0));
    setActualRemainingInput(
      existingLine?.actualRemainingQuantity != null
        ? String(existingLine.actualRemainingQuantity)
        : "",
    );
    focusAndSelectInput(initialLoadRef);
  }

  function commitQuickEntry() {
    if (!openLoading) {
      toast.error("Creez d'abord une fiche de chargement.");
      return;
    }
    if (!selectedProduct) {
      toast.error("Selectionnez un produit.");
      return;
    }

    const nextLine: DraftLoadingLine = {
      productId: selectedProduct.product.id,
      productName: selectedProduct.product.name,
      productReference: selectedProduct.product.reference,
      productBarcode: selectedProduct.product.barcode,
      productUnit: selectedProduct.product.unit,
      depotAvailableQuantity: selectedProduct.depotAvailableQuantity,
      initialLoadQuantity: parseInteger(initialLoadInput, 0),
      reloadedQuantity: parseInteger(reloadedInput, 0),
      actualRemainingQuantity: parseIntegerOrNull(actualRemainingInput),
    };

    setDraftLines((current) =>
      current.some((line) => line.productId === nextLine.productId)
        ? current.map((line) => (line.productId === nextLine.productId ? nextLine : line))
        : [nextLine, ...current],
    );

    resetQuickEntry();
  }

  function updateDraftLine(
    productId: string,
    updates: Partial<
      Pick<DraftLoadingLine, "initialLoadQuantity" | "reloadedQuantity" | "actualRemainingQuantity">
    >,
  ) {
    setDraftLines((current) =>
      current.map((line) => {
        if (line.productId !== productId) return line;
        return {
          ...line,
          initialLoadQuantity: updates.initialLoadQuantity ?? line.initialLoadQuantity,
          reloadedQuantity: updates.reloadedQuantity ?? line.reloadedQuantity,
          actualRemainingQuantity:
            "actualRemainingQuantity" in updates
              ? updates.actualRemainingQuantity ?? null
              : line.actualRemainingQuantity,
        };
      }),
    );
  }

  function handleProductSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (productSuggestions.length === 0) return;
      setSuggestionsOpen(true);
      setActiveSuggestionIndex((current) => Math.min(current + 1, productSuggestions.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (productSuggestions.length === 0) return;
      setSuggestionsOpen(true);
      setActiveSuggestionIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const exactMatches = productSuggestions.filter(
        (suggestion) =>
          normalizeSearch(suggestion.product.reference) === normalizeSearch(productSearch) ||
          normalizeSearch(suggestion.product.barcode ?? "") === normalizeSearch(productSearch),
      );
      if (exactMatches.length === 1) {
        chooseSuggestion(exactMatches[0]);
        return;
      }
      if (suggestionsOpen && productSuggestions[activeProductSuggestionIndex]) {
        chooseSuggestion(productSuggestions[activeProductSuggestionIndex]);
        return;
      }
      if (productSuggestions[0]) {
        chooseSuggestion(productSuggestions[0]);
      }
    }
  }

  // Item 7: a truck already having an OPEN fiche is never an error - the
  // server returns that fiche and we just display it (createOrReuseOpenLoading).
  async function createOrResumeLoading() {
    if (!selectedDriver) {
      toast.error("Selectionnez un chauffeur.");
      return;
    }
    if (!selectedTruck) {
      toast.error("Aucun camion affecte a ce chauffeur.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/truck-loadings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          truckId: selectedTruck.id,
          driverId: selectedDriver.id,
          date: selectedDate,
        }),
      });
      const body = (await response.json()) as {
        loading?: TruckLoadingDto;
        reused?: boolean;
        message?: string;
      };
      if (!response.ok || !body.loading) {
        toast.error(body.message ?? "Impossible de creer la fiche de chargement.");
        return;
      }

      setOpenLoading(body.loading);

      if (body.reused) {
        toast.info(
          `Une fiche de chargement ouverte existe deja pour ${selectedTruck.code}. ${body.loading.displayNumber} a ete chargee.`,
        );
      } else {
        toast.success(`${body.loading.displayNumber} cree.`);
      }
    } finally {
      setBusy(false);
    }
  }

  // Item 9: progressive persistence - this is a plain save, never the first
  // and only time data reaches the database.
  async function saveDraft() {
    if (!openLoading) return;
    if (draftLines.length === 0) {
      toast.error("Ajoutez au moins un produit.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/truck-loadings/${openLoading.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: draftLines.map((line) => ({
            productId: line.productId,
            initialQuantity: line.initialLoadQuantity,
            reloadedQuantity: line.reloadedQuantity,
          })),
        }),
      });
      const body = (await response.json()) as { loading?: TruckLoadingDto; message?: string };
      if (!response.ok || !body.loading) {
        toast.error(body.message ?? "Impossible d'enregistrer le brouillon.");
        return;
      }
      setOpenLoading(body.loading);
      toast.success("Brouillon enregistre, stock camion et depot mis a jour.");
    } finally {
      setBusy(false);
    }
  }

  async function closeLoading() {
    if (!openLoading) return;
    const missingLine = draftLines.find((line) => line.actualRemainingQuantity === null);
    if (missingLine) {
      toast.error("Veuillez saisir la quantite restante reelle pour tous les produits.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/truck-loadings/${openLoading.id}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: draftLines.map((line) => ({
            productId: line.productId,
            actualRemainingQuantity: line.actualRemainingQuantity,
          })),
        }),
      });
      const body = (await response.json()) as { loading?: TruckLoadingDto; message?: string };
      if (!response.ok || !body.loading) {
        toast.error(body.message ?? "Impossible de fermer le chargement.");
        return;
      }

      toast.success(`${body.loading.displayNumber} ferme.`);
      setHistoryState((current) => upsertLoading(current, body.loading as TruckLoadingDto));
      setOpenLoading(null);
      setDraftLines([]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Chargements</h1>
        <p className="text-sm text-muted-foreground">
          Fiches de chargement independantes des tournees, centrees sur le camion.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList variant="line" className="rounded-2xl border border-border bg-muted/30 p-1">
          <TabsTrigger value="loading">Chargement</TabsTrigger>
          <TabsTrigger value="history">Historique des chargements</TabsTrigger>
        </TabsList>

        <TabsContent value="loading" className="space-y-6">
          <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
            <CardContent className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-[180px_1fr_240px]">
                <Field label="Date">
                  <Input
                    type="date"
                    value={selectedDate}
                    onChange={(event) => setSelectedDate(event.target.value)}
                  />
                </Field>
                <Field label="Chauffeur">
                  <NativeSelect
                    value={selectedDriverId}
                    onChange={(event) => setSelectedDriverId(event.target.value)}
                  >
                    <option value="">Selectionner</option>
                    {driversState.map((driver) => (
                      <option key={driver.id} value={driver.id}>
                        {formatDriverOptionLabel(driver)}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                {!openLoading ? (
                  <div className="flex items-end">
                    <Button
                      type="button"
                      disabled={busy || !selectedDriver || !openLoadingLoaded}
                      className="h-10 w-full"
                      onClick={createOrResumeLoading}
                    >
                      <Plus className="h-4 w-4" />
                      Nouvelle fiche de chargement
                    </Button>
                  </div>
                ) : null}
              </div>

              {selectedDriver ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <InfoCard
                    icon={UserRound}
                    label="Chauffeur"
                    value={selectedDriver.user.fullName}
                    secondary={selectedDriver.user.email}
                  />
                  <InfoCard
                    icon={Warehouse}
                    label="Depot de rattachement"
                    value={selectedTruck?.depot.name ?? "-"}
                  />
                  <InfoCard
                    icon={Truck}
                    label="Camion affecte"
                    value={
                      selectedTruck
                        ? `${selectedTruck.code} - ${selectedTruck.registration}`
                        : "Aucun camion affecte a cet utilisateur"
                    }
                  />
                  <InfoCard
                    icon={PackageCheck}
                    label="Stock actuel du camion"
                    value={selectedTruck ? formatTruckStock(selectedTruck) : "-"}
                  />
                </div>
              ) : null}

              {selectedDriver && !selectedTruck ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  Aucun camion affecte a cet utilisateur.
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
            <CardContent className="space-y-5">
              {!selectedDriver ? (
                <p className="text-sm text-muted-foreground">
                  Selectionnez une date et un chauffeur pour commencer.
                </p>
              ) : !openLoadingLoaded ? (
                <p className="text-sm text-muted-foreground">Chargement en cours...</p>
              ) : !openLoading ? (
                <p className="text-sm text-muted-foreground">
                  Aucune fiche de chargement ouverte. Cliquez sur &laquo; Nouvelle fiche de
                  chargement &raquo; pour en creer une.
                </p>
              ) : (
                <>
                  <section className="space-y-4 rounded-2xl border border-border bg-muted/10 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-foreground">
                          {openLoading.displayNumber}
                        </p>
                        <h2 className="font-heading text-lg font-semibold">
                          {openLoading.driverName}
                        </h2>
                        <p className="text-sm text-muted-foreground">
                          {formatTruckLabel(selectedTruck)}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {new Date(openLoading.date).toLocaleDateString("fr-FR")} -{" "}
                          {openLoading.depotName}
                        </p>
                      </div>
                      <LoadingStatusBadge status={openLoading.status} />
                    </div>

                    <div className="grid gap-3 md:grid-cols-4">
                      <MetricCard label="Charge initiale" value={draftTotals.initialLoadQuantity} />
                      <MetricCard label="Rechargee" value={draftTotals.reloadedQuantity} />
                      <MetricCard
                        label="Restante theorique"
                        value={draftTotals.theoreticalRemainingQuantity}
                      />
                      <MetricCard
                        label="Restante reelle"
                        value={draftTotals.actualRemainingQuantity}
                      />
                    </div>
                  </section>

                  <section className="space-y-3">
                    <div className="space-y-1">
                      <h3 className="text-sm font-medium text-foreground">Produits charges</h3>
                      <p className="text-sm text-muted-foreground">
                        L&apos;enregistrement du brouillon met immediatement a jour le stock reel
                        du camion et du depot.
                      </p>
                    </div>

                    <div className="overflow-x-auto rounded-2xl border border-border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Produit</TableHead>
                            <TableHead className="text-right">Stock depot</TableHead>
                            <TableHead className="text-right">Charge initiale</TableHead>
                            <TableHead className="text-right">Rechargee</TableHead>
                            <TableHead className="text-right">Restante theorique</TableHead>
                            <TableHead className="text-right">Restante reelle</TableHead>
                            <TableHead className="text-right">Action</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {draftLines.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                                Aucun produit ajoute. Utilisez la zone d&apos;ajout ci-dessous
                                pour remplir la fiche.
                              </TableCell>
                            </TableRow>
                          ) : (
                            draftLines.map((line) => (
                              <TableRow key={line.productId}>
                                <TableCell>
                                  <div className="font-medium">{line.productName}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {line.productReference}
                                    {line.productBarcode ? ` - ${line.productBarcode}` : ""}
                                    {` - ${line.productUnit}`}
                                  </div>
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {line.depotAvailableQuantity}
                                </TableCell>
                                <TableCell className="w-[140px]">
                                  <Input
                                    type="number"
                                    min={0}
                                    value={String(line.initialLoadQuantity)}
                                    disabled={loadingIsLocked}
                                    onFocus={(event) => event.currentTarget.select()}
                                    onChange={(event) =>
                                      updateDraftLine(line.productId, {
                                        initialLoadQuantity: parseInteger(event.target.value, 0),
                                      })
                                    }
                                  />
                                </TableCell>
                                <TableCell className="w-[140px]">
                                  <Input
                                    type="number"
                                    min={0}
                                    value={String(line.reloadedQuantity)}
                                    disabled={loadingIsLocked}
                                    onFocus={(event) => event.currentTarget.select()}
                                    onChange={(event) =>
                                      updateDraftLine(line.productId, {
                                        reloadedQuantity: parseInteger(event.target.value, 0),
                                      })
                                    }
                                  />
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {truckLevelsByProductId[line.productId] ?? 0}
                                </TableCell>
                                <TableCell className="w-[160px]">
                                  <Input
                                    type="number"
                                    min={0}
                                    placeholder="A saisir"
                                    value={
                                      line.actualRemainingQuantity === null
                                        ? ""
                                        : String(line.actualRemainingQuantity)
                                    }
                                    disabled={loadingIsLocked}
                                    onFocus={(event) => event.currentTarget.select()}
                                    onChange={(event) =>
                                      updateDraftLine(line.productId, {
                                        actualRemainingQuantity: parseIntegerOrNull(
                                          event.target.value,
                                        ),
                                      })
                                    }
                                  />
                                </TableCell>
                                <TableCell className="text-right">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    disabled={loadingIsLocked}
                                    onClick={() =>
                                      setDraftLines((current) =>
                                        current.filter(
                                          (currentLine) => currentLine.productId !== line.productId,
                                        ),
                                      )
                                    }
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </section>

                  {!loadingIsLocked ? (
                    <section className="space-y-3 rounded-2xl border border-border bg-muted/20 p-4">
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-foreground">Ajouter un produit</p>
                        <p className="text-sm text-muted-foreground">
                          Ajoutez rapidement un produit puis ajustez ses quantites directement
                          dans le tableau si besoin.
                        </p>
                      </div>

                      <div className="grid gap-3 lg:grid-cols-[minmax(260px,2.2fr)_140px_140px_140px_110px]">
                        <div className="relative">
                          <Field label="Recherche produit">
                            <div className="relative">
                              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                              <Input
                                ref={productSearchRef}
                                value={productSearch}
                                onChange={(event) => {
                                  setProductSearch(event.target.value);
                                  setSelectedProduct(null);
                                  setSuggestionsOpen(true);
                                  setActiveSuggestionIndex(0);
                                }}
                                onFocus={() => {
                                  if (productSearch.trim()) setSuggestionsOpen(true);
                                }}
                                onBlur={() => {
                                  window.setTimeout(() => setSuggestionsOpen(false), 120);
                                }}
                                onKeyDown={handleProductSearchKeyDown}
                                placeholder="Rechercher ou scanner un produit..."
                                className="pl-9"
                              />
                            </div>
                          </Field>

                          {suggestionsOpen && productSuggestions.length > 0 ? (
                            <div className="absolute z-20 mt-2 w-full rounded-2xl border border-border bg-background p-2 shadow-lg">
                              <div className="max-h-80 overflow-y-auto">
                                {productSuggestions.map((suggestion, index) => (
                                  <button
                                    key={suggestion.product.id}
                                    type="button"
                                    className={`flex w-full flex-col rounded-xl px-3 py-2 text-left transition ${
                                      index === activeProductSuggestionIndex
                                        ? "bg-emerald-50 text-emerald-900"
                                        : "hover:bg-muted/60"
                                    }`}
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => chooseSuggestion(suggestion)}
                                  >
                                    <span className="font-medium">{suggestion.product.name}</span>
                                    <span className="text-xs text-muted-foreground">
                                      {suggestion.product.reference}
                                      {suggestion.product.barcode
                                        ? ` - ${suggestion.product.barcode}`
                                        : ""}
                                      {` - ${suggestion.product.unit}`}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      Stock camion actuel: {suggestion.truckCurrentQuantity} |
                                      Stock depot disponible: {suggestion.depotAvailableQuantity}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>

                        <Field label="Charge initiale">
                          <Input
                            ref={initialLoadRef}
                            type="number"
                            min={0}
                            value={initialLoadInput}
                            disabled={!selectedProduct}
                            onFocus={(event) => event.currentTarget.select()}
                            onChange={(event) => setInitialLoadInput(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key !== "Enter") return;
                              event.preventDefault();
                              focusAndSelectInput(reloadedRef);
                            }}
                          />
                        </Field>

                        <Field label="Rechargee">
                          <Input
                            ref={reloadedRef}
                            type="number"
                            min={0}
                            value={reloadedInput}
                            disabled={!selectedProduct}
                            onFocus={(event) => event.currentTarget.select()}
                            onChange={(event) => setReloadedInput(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key !== "Enter") return;
                              event.preventDefault();
                              focusAndSelectInput(actualRemainingRef);
                            }}
                          />
                        </Field>

                        <Field label="Restante reelle">
                          <Input
                            ref={actualRemainingRef}
                            type="number"
                            min={0}
                            value={actualRemainingInput}
                            disabled={!selectedProduct}
                            onFocus={(event) => event.currentTarget.select()}
                            onChange={(event) => setActualRemainingInput(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key !== "Enter") return;
                              event.preventDefault();
                              commitQuickEntry();
                            }}
                          />
                        </Field>

                        <div className="flex items-end">
                          <Button
                            type="button"
                            variant="outline"
                            className="w-full"
                            disabled={!selectedProduct}
                            onClick={commitQuickEntry}
                          >
                            Ajouter
                          </Button>
                        </div>
                      </div>
                    </section>
                  ) : (
                    <div className="flex items-center gap-2 rounded-2xl border border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                      <Lock className="h-4 w-4" />
                      Ce chargement est ferme et n&apos;est plus modifiable.
                    </div>
                  )}

                  {!loadingIsLocked ? (
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" disabled={busy} onClick={saveDraft}>
                        <RefreshCw className="h-4 w-4" />
                        Enregistrer le brouillon
                      </Button>
                      <Button type="button" disabled={busy} onClick={closeLoading}>
                        <Lock className="h-4 w-4" />
                        Fermer le chargement
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="space-y-6">
          <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <ClipboardList className="h-5 w-5 text-emerald-700" />
                <h2 className="font-heading text-lg font-semibold">
                  Historique des chargements
                </h2>
              </div>

              <Field label="Recherche">
                <Input
                  value={historySearch}
                  onChange={(event) => setHistorySearch(event.target.value)}
                  placeholder="Rechercher par numero, chauffeur, camion ou depot..."
                />
              </Field>

              <p className="text-sm text-muted-foreground">
                {filteredHistory.length} fiche
                {filteredHistory.length > 1 ? "s" : ""} de chargement.
              </p>

              <div className="overflow-x-auto rounded-2xl border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Numero</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Chauffeur</TableHead>
                      <TableHead>Camion</TableHead>
                      <TableHead>Tournee</TableHead>
                      <TableHead>Depot</TableHead>
                      <TableHead className="text-right">Produits</TableHead>
                      <TableHead className="text-right">Quantite</TableHead>
                      <TableHead>Ouverture</TableHead>
                      <TableHead>Fermeture</TableHead>
                      <TableHead>Statut</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredHistory.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={12} className="py-8 text-center text-muted-foreground">
                          Aucune fiche de chargement ne correspond a la recherche.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredHistory.map((loading) => (
                        <TableRow key={loading.id}>
                          <TableCell className="font-medium text-foreground">
                            {loading.displayNumber}
                          </TableCell>
                          <TableCell>{new Date(loading.date).toLocaleDateString("fr-FR")}</TableCell>
                          <TableCell>{loading.driverName}</TableCell>
                          <TableCell>{loading.truckCode}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {loading.tourCode ?? "-"}
                          </TableCell>
                          <TableCell>{loading.depotName}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {loading.lines.length}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {loading.lines.reduce((sum, line) => sum + line.quantity, 0)}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {new Date(loading.createdAt).toLocaleString("fr-FR")}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {loading.closedAt
                              ? new Date(loading.closedAt).toLocaleString("fr-FR")
                              : "-"}
                          </TableCell>
                          <TableCell>
                            <LoadingStatusBadge status={loading.status} />
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              render={<Link href={`/chargements/${loading.id}`} />}
                            >
                              Voir
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
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

function LoadingStatusBadge({ status }: { status: string }) {
  const variant = status === "CANCELLED" ? "destructive" : status === "VALIDATED" ? "secondary" : "default";
  return <Badge variant={variant}>{loadingStatusLabels[status] ?? status}</Badge>;
}

function InfoCard({
  icon: Icon,
  label,
  value,
  secondary,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  secondary?: string | null;
}) {
  return (
    <div className="rounded-2xl border border-border p-4">
      <div className="flex items-center gap-2 text-emerald-700">
        <Icon className="h-4 w-4" />
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
      <p className="mt-2 truncate text-sm font-semibold text-foreground">{value}</p>
      {secondary ? <p className="text-xs text-muted-foreground">{secondary}</p> : null}
    </div>
  );
}

function MetricCard({
  label,
  value,
  valueLabel,
}: {
  label: string;
  value?: number;
  valueLabel?: string;
}) {
  return (
    <div className="rounded-2xl border border-border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-2 text-xl font-semibold text-foreground tabular-nums">
        {valueLabel ?? value ?? 0}
      </p>
    </div>
  );
}

function formatTruckLabel(truck?: Pick<TruckDto, "code" | "registration"> | null) {
  if (!truck) return "Aucun camion affecte";
  return `${truck.code} - ${truck.registration}`;
}

function formatDriverOptionLabel(driver: DriverAssignmentDto) {
  const truckLabel = formatTruckLabel(driver.truck);
  return `${driver.user.fullName} - ${truckLabel}`;
}

function formatTruckStock(truck: TruckDto) {
  const totalQuantity = truck.stockSummary?.totalQuantity ?? 0;
  const productCount = truck.stockSummary?.productCount ?? 0;
  return `${totalQuantity} unites / ${productCount} produits`;
}

function formatSuggestionLabel(product: ProductDto) {
  return `${product.name} (${product.reference})`;
}

function todayDateInput() {
  return new Date().toISOString().slice(0, 10);
}

function parseInteger(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseIntegerOrNull(value: string | undefined) {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

function toQuantityMap(levels: StockLevelDto[]) {
  return Object.fromEntries(levels.map((level) => [level.productId, level.quantity]));
}

function toAvailableQuantityMap(levels: StockLevelDto[]) {
  return Object.fromEntries(levels.map((level) => [level.productId, level.availableQuantity]));
}

function upsertLoading(loadings: TruckLoadingDto[], loading: TruckLoadingDto) {
  const exists = loadings.some((item) => item.id === loading.id);
  return exists
    ? loadings.map((item) => (item.id === loading.id ? loading : item))
    : [loading, ...loadings];
}
