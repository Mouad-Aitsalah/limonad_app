-- F7 (Phase 2 audit): at most one EN_COURS (open) Inventory per depot at a
-- time, scoped by organization. Mirrors the exact same pattern already used
-- for TruckLoading's "one open loading per truck" constraint
-- (TruckLoading_open_per_truck_key) - a partial unique index, since
-- Prisma's schema syntax cannot express a filtered/partial unique index.
-- Additive only: no existing column touched, no row modified. Depot is the
-- correct scope here (not a separate stockLocationId column) because
-- StockLocation.depotId is already @unique - a depot has at most one
-- StockLocation, so "same depot" and "same stock location" are exactly
-- equivalent for Inventory, which has always been depot-scoped only (never
-- truck-scoped).

-- CreateIndex
CREATE UNIQUE INDEX "Inventory_open_per_depot_key"
ON "Inventory"("organizationId", "depotId")
WHERE "status" = 'EN_COURS';
