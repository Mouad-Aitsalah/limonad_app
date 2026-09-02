"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppPageHeader } from "@/components/ui/app-page-header";
import { DataTableShell } from "@/components/ui/data-table-shell";
import { SectionCard } from "@/components/ui/section-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StockAdjustmentDialog } from "@/components/stock/stock-adjustment-dialog";
import { StockKpiCards } from "@/components/stock/stock-kpi-cards";
import { StockMovementsTable } from "@/components/stock/stock-movements-table";
import { StockToolbar } from "@/components/stock/stock-toolbar";
import { TruckStockPanel } from "@/components/stock/truck-stock-panel";
import { useStockMovementsPage } from "@/components/stock/use-stock-movements-page";
import { WarehouseStockTable } from "@/components/stock/warehouse-stock-table";
import type {
  StockLevelDto,
  StockLocationDto,
  StockMovementsPageDto,
  StockSummaryDto,
} from "@/types/operations-dto";
import type { ProductDto } from "@/types/product-dto";

const MOVEMENTS_SEARCH_DEBOUNCE_MS = 400;

type StockFilters = {
  search: string;
  categoryId: string;
  brandId: string;
  supplierId: string;
};

const defaultFilters: StockFilters = {
  search: "",
  categoryId: "all",
  brandId: "all",
  supplierId: "all",
};

type StockViewProps = {
  initialLevels: StockLevelDto[];
  locations: StockLocationDto[];
  initialMovementsPage: StockMovementsPageDto;
  summary: StockSummaryDto;
  products: ProductDto[];
};

export function StockView({
  initialLevels,
  locations,
  initialMovementsPage,
  summary,
  products,
}: StockViewProps) {
  const [filters, setFilters] = React.useState<StockFilters>(defaultFilters);
  const [levels, setLevels] = React.useState(initialLevels);
  const [stockSummary, setStockSummary] = React.useState(summary);

  const [movementsSearch, setMovementsSearch] = React.useState("");
  const [debouncedMovementsSearch, setDebouncedMovementsSearch] = React.useState("");
  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedMovementsSearch(movementsSearch), MOVEMENTS_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [movementsSearch]);

  const {
    items: stockMovements,
    totalCount: movementsTotalCount,
    pageIndex: movementsPageIndex,
    hasMore: movementsHasMore,
    hasPrevious: movementsHasPrevious,
    loading: movementsLoading,
    goToNextPage: goToNextMovementsPage,
    goToPreviousPage: goToPreviousMovementsPage,
    refetchCurrentPage: refetchMovementsPage,
  } = useStockMovementsPage({ search: debouncedMovementsSearch }, initialMovementsPage);

  const filteredLevels = React.useMemo(
    () => filterStockLevels(levels, filters),
    [levels, filters],
  );
  const warehouseRows = filteredLevels.filter((level) => level.locationType === "DEPOT");
  const truckRows = filteredLevels.filter((level) => level.locationType === "TRUCK");
  const truckLocations = locations.filter((location) => location.type === "TRUCK");

  const categories = React.useMemo(() => uniqueOptions(levels, "category"), [levels]);
  const brands = React.useMemo(() => uniqueOptions(levels, "brand"), [levels]);
  const suppliers = React.useMemo(() => uniqueOptions(levels, "supplier"), [levels]);

  function handleFilterChange<K extends keyof StockFilters>(
    key: K,
    value: StockFilters[K],
  ) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  async function refreshStock() {
    const stockResponse = await fetch("/api/stock", { cache: "no-store" });
    if (stockResponse.ok) {
      const payload = (await stockResponse.json()) as {
        levels: StockLevelDto[];
        summary: StockSummaryDto;
      };
      setLevels(payload.levels);
      setStockSummary(payload.summary);
    }
    await refetchMovementsPage();
  }

  return (
    <div className="space-y-6">
      <AppPageHeader
        eyebrow="Operations"
        title="Stock"
        description="Suivez les quantites, la valeur, les alertes et les mouvements entre depot et camions dans un seul ecran."
        actions={
          <StockAdjustmentDialog
            products={products}
            locations={locations}
            onAdjusted={() => {
              void refreshStock();
            }}
          />
        }
      />

      <StockKpiCards totals={stockSummary} />

      <SectionCard
        title="Vue stock"
        description="Basculez entre depot principal, camions et vision globale sans perdre vos filtres."
        contentClassName="space-y-5"
      >
        <Tabs defaultValue="warehouse">
          <TabsList>
            <TabsTrigger value="warehouse">Stock principal</TabsTrigger>
            <TabsTrigger value="trucks">Stock camions</TabsTrigger>
            <TabsTrigger value="all">Tous les emplacements</TabsTrigger>
          </TabsList>

          <TabsContent value="warehouse" className="mt-5 space-y-5">
            <StockToolbar
              filters={filters}
              categories={categories}
              brands={brands}
              suppliers={suppliers}
              onChange={handleFilterChange}
            />
            <p className="text-sm text-muted-foreground">
              {warehouseRows.length} ligne(s) en stock principal
            </p>
            <div className="overflow-hidden rounded-[22px] border border-border/70 bg-white/82">
              <WarehouseStockTable rows={warehouseRows} />
            </div>
          </TabsContent>

        <TabsContent value="trucks" className="mt-5">
            <TruckStockPanel
              locations={truckLocations}
              rows={truckRows}
              products={products}
              onAdjusted={() => {
                void refreshStock();
              }}
            />
          </TabsContent>

          <TabsContent value="all" className="mt-5 space-y-5">
            <StockToolbar
              filters={filters}
              categories={categories}
              brands={brands}
              suppliers={suppliers}
              onChange={handleFilterChange}
            />
            <div className="overflow-hidden rounded-[22px] border border-border/70 bg-white/82">
              <WarehouseStockTable rows={filteredLevels} />
            </div>
          </TabsContent>
        </Tabs>
      </SectionCard>

      <DataTableShell
        title="Mouvements de stock"
        description="Historique immuable des receptions, chargements, retours, ventes et ajustements."
        toolbar={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Input
              value={movementsSearch}
              onChange={(event) => setMovementsSearch(event.target.value)}
              placeholder="Rechercher un numero de mouvement (MV-...)"
              className="max-w-xs"
            />
            <div className="flex items-center gap-3">
              <p className="text-sm text-muted-foreground">
                Page {movementsPageIndex + 1} &middot; {stockMovements.length} sur {movementsTotalCount} au
                total
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!movementsHasPrevious || movementsLoading}
                onClick={goToPreviousMovementsPage}
              >
                Precedent
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!movementsHasMore || movementsLoading}
                onClick={goToNextMovementsPage}
              >
                Suivant
              </Button>
            </div>
          </div>
        }
      >
        <StockMovementsTable movements={stockMovements} />
      </DataTableShell>
    </div>
  );
}

function filterStockLevels(levels: StockLevelDto[], filters: StockFilters) {
  const query = filters.search.trim().toLowerCase();
  return levels.filter((level) => {
    const matchesSearch =
      query.length === 0 ||
      level.productName.toLowerCase().includes(query) ||
      level.productReference.toLowerCase().includes(query) ||
      (level.barcode?.includes(query) ?? false) ||
      level.locationCode.toLowerCase().includes(query);
    const matchesCategory =
      filters.categoryId === "all" || level.categoryId === filters.categoryId;
    const matchesBrand = filters.brandId === "all" || level.brandId === filters.brandId;
    const matchesSupplier =
      filters.supplierId === "all" || level.supplierId === filters.supplierId;
    return matchesSearch && matchesCategory && matchesBrand && matchesSupplier;
  });
}

function uniqueOptions(levels: StockLevelDto[], key: "category" | "brand" | "supplier") {
  const options = new Map<string, string>();
  for (const level of levels) {
    if (key === "category") options.set(level.categoryId, level.categoryName);
    if (key === "brand" && level.brandId && level.brandName) {
      options.set(level.brandId, level.brandName);
    }
    if (key === "supplier" && level.supplierId && level.supplierName) {
      options.set(level.supplierId, level.supplierName);
    }
  }
  return Array.from(options.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
