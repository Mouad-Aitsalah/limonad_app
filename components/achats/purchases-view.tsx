"use client";

import * as React from "react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { suppliers as fallbackSuppliers } from "@/lib/mock-data/suppliers";
import { PurchaseDialog } from "@/components/achats/purchase-dialog";
import {
  PurchasesToolbar,
  defaultPurchasesFilters,
  type PurchasesFilters,
} from "@/components/achats/purchases-toolbar";
import { PurchasesTable } from "@/components/achats/purchases-table";
import { PurchasesPagination } from "@/components/achats/purchases-pagination";
import type { Purchase } from "@/types/purchase";
import type { ProductDto, ProductOptionDto } from "@/types/product-dto";

const PAGE_SIZE = 10;

async function fetchPurchases() {
  const response = await fetch("/api/purchases", {
    cache: "no-store",
    credentials: "include",
  });
  const payload = (await response.json()) as {
    purchases?: Purchase[];
    message?: string;
  };

  if (!response.ok || !payload.purchases) {
    throw new Error(payload.message ?? "Impossible de charger les achats.");
  }

  return payload.purchases.map((purchase) => ({
    ...purchase,
    date: new Date(purchase.date),
    datePaiement: purchase.datePaiement ? new Date(purchase.datePaiement) : null,
    createdAt: new Date(purchase.createdAt),
    updatedAt: new Date(purchase.updatedAt),
  }));
}

function supplierName(id: string, supplierOptions: ProductOptionDto[]) {
  return (
    supplierOptions.find((supplier) => supplier.id === id)?.name ??
    fallbackSuppliers.find((supplier) => supplier.id === id)?.nom ??
    ""
  );
}

export function PurchasesView() {
  const [purchases, setPurchases] = React.useState<Purchase[]>([]);
  const [supplierOptions, setSupplierOptions] = React.useState<ProductOptionDto[]>([]);
  const [productOptions, setProductOptions] = React.useState<ProductDto[]>([]);
  const [filters, setFilters] = React.useState<PurchasesFilters>(
    defaultPurchasesFilters,
  );
  const [page, setPage] = React.useState(1);

  React.useEffect(() => {
    let cancelled = false;

    async function loadSuppliers() {
      const response = await fetch("/api/suppliers", { cache: "no-store" });
      const payload = (await response.json()) as {
        suppliers?: ProductOptionDto[];
      };

      if (!response.ok || !payload.suppliers) {
        throw new Error("Impossible de charger les fournisseurs.");
      }

      if (!cancelled) {
        setSupplierOptions(payload.suppliers);
      }
    }

    void loadSuppliers().catch(() => {
      if (!cancelled) {
        setSupplierOptions([]);
      }
    });

    // Phase 3 CRITICAL #1 fix: small bounded preload instead of
    // GET /api/products (getProducts(), measured 12.5s/56MB at 100k
    // products) - already ACTIVE-only. See PurchaseForm's product search.
    async function loadProducts() {
      const response = await fetch("/api/products/preload", { cache: "no-store" });
      const payload = (await response.json()) as {
        products?: ProductDto[];
      };

      if (!response.ok || !payload.products) {
        throw new Error("Impossible de charger les produits.");
      }

      if (!cancelled) {
        setProductOptions(payload.products);
      }
    }

    void loadProducts().catch(() => {
      if (!cancelled) {
        setProductOptions([]);
      }
    });

    void fetchPurchases()
      .then((items) => {
        if (!cancelled) setPurchases(items);
      })
      .catch((error) => {
        if (!cancelled) {
          setPurchases([]);
          toast.error(
            error instanceof Error
              ? error.message
              : "Impossible de charger les achats.",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function handleFilterChange<K extends keyof PurchasesFilters>(
    key: K,
    value: PurchasesFilters[K],
  ) {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  }

  async function handleAddPurchase(
    purchase: Omit<Purchase, "id" | "numero" | "createdAt" | "updatedAt">,
  ) {
    const response = await fetch("/api/purchases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        date: purchase.date.toISOString().slice(0, 10),
        fournisseurId: purchase.fournisseurId,
        modeReglement: purchase.modeReglement,
        numeroCheque: purchase.numeroCheque,
        banque: purchase.banque,
        datePaiement: purchase.datePaiement?.toISOString().slice(0, 10) ?? null,
        observation: purchase.observation,
        lignes: purchase.lignes,
      }),
    });
    const payload = (await response.json()) as {
      purchase?: Purchase;
      message?: string;
    };

    if (!response.ok || !payload.purchase) {
      throw new Error(payload.message ?? "Impossible d'enregistrer l'achat.");
    }

    setPurchases(await fetchPurchases());
    setPage(1);
    toast.success(`Achat ${payload.purchase.numero} enregistré avec succès.`);
  }

  const filteredPurchases = React.useMemo(() => {
    const query = filters.search.trim().toLowerCase();
    const from = filters.dateFrom ? new Date(filters.dateFrom) : null;
    const to = filters.dateTo ? new Date(filters.dateTo) : null;
    if (to) to.setHours(23, 59, 59, 999);

    return purchases
      .filter((purchase) => {
        const matchesSearch =
          query.length === 0 ||
          purchase.numero.toLowerCase().includes(query) ||
          supplierName(purchase.fournisseurId, supplierOptions).toLowerCase().includes(query);

        const matchesFrom = !from || purchase.date >= from;
        const matchesTo = !to || purchase.date <= to;

        const matchesFournisseur =
          filters.fournisseur === "all" ||
          purchase.fournisseurId === filters.fournisseur;

        const matchesReglement =
          filters.modeReglement === "all" ||
          purchase.modeReglement === filters.modeReglement;

        const matchesUtilisateur =
          filters.utilisateur === "all" ||
          purchase.utilisateurId === filters.utilisateur;

        const matchesStatut =
          filters.statut === "all" || purchase.statut === filters.statut;

        return (
          matchesSearch &&
          matchesFrom &&
          matchesTo &&
          matchesFournisseur &&
          matchesReglement &&
          matchesUtilisateur &&
          matchesStatut
        );
      })
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [purchases, filters, supplierOptions]);

  const totalPages = Math.max(1, Math.ceil(filteredPurchases.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginatedPurchases = filteredPurchases.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            Achats
          </h1>
          <p className="text-sm text-muted-foreground">
            Factures d&apos;achat fournisseurs.
          </p>
        </div>

        <PurchaseDialog
          onSaved={handleAddPurchase}
          productOptions={productOptions}
          supplierOptions={supplierOptions}
        />
      </div>

      <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
        <CardContent className="space-y-5">
          <PurchasesToolbar
            filters={filters}
            onChange={handleFilterChange}
            supplierOptions={supplierOptions}
          />

          <p className="text-sm text-muted-foreground">
            {filteredPurchases.length} achat
            {filteredPurchases.length > 1 ? "s" : ""}
          </p>

          <PurchasesTable
            purchases={paginatedPurchases}
            supplierOptions={supplierOptions}
          />

          <PurchasesPagination
            page={currentPage}
            totalPages={totalPages}
            onPageChange={setPage}
          />
        </CardContent>
      </Card>
    </div>
  );
}
