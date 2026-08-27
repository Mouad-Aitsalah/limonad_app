"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Pencil, Search, X } from "lucide-react";
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
import type { TruckLoadingDto } from "@/types/operations-dto";
import type { ProductDto } from "@/types/product-dto";

const loadingStatusLabels: Record<string, string> = {
  DRAFT: "Ouvert",
  VALIDATED: "Ferme",
  CANCELLED: "Annule",
};

type EditableLine = {
  productId: string;
  productName: string;
  productReference: string;
  productBarcode?: string | null;
  productUnit: string;
  depotAvailableQuantity: number;
  initialLoadQuantity: number;
  reloadedQuantity: number;
  actualRemainingQuantity: number | null;
  theoreticalDisplay: number;
};

type ProductSuggestion = { product: ProductDto };

function buildLinesFromLoading(loading: TruckLoadingDto): EditableLine[] {
  return loading.lines.map((line) => ({
    productId: line.productId,
    productName: line.productName,
    productReference: line.productReference,
    productBarcode: null,
    productUnit: "",
    depotAvailableQuantity: line.depotAvailableQuantity,
    initialLoadQuantity: line.initialQuantity,
    reloadedQuantity: line.reloadedQuantity,
    actualRemainingQuantity: line.actualRemainingQuantity,
    theoreticalDisplay: line.theoreticalRemainingQuantity ?? line.truckCurrentQuantity,
  }));
}

export function LoadingDetailView({
  loading: initialLoading,
  products,
}: {
  loading: TruckLoadingDto;
  products: ProductDto[];
}) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(initialLoading);
  const [mode, setMode] = React.useState<"view" | "edit">("view");
  const [lines, setLines] = React.useState<EditableLine[]>(() => buildLinesFromLoading(initialLoading));
  const [busy, setBusy] = React.useState(false);

  const [productSearch, setProductSearch] = React.useState("");
  const [suggestionsOpen, setSuggestionsOpen] = React.useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = React.useState(0);
  const deferredProductSearch = React.useDeferredValue(productSearch);
  const searchRef = React.useRef<HTMLInputElement | null>(null);

  const suggestions = React.useMemo<ProductSuggestion[]>(() => {
    const query = normalizeSearch(deferredProductSearch);
    if (!query) return [];
    return products
      .filter((product) => {
        const haystack = normalizeSearch(
          `${product.name} ${product.reference} ${product.barcode ?? ""}`,
        );
        return haystack.includes(query);
      })
      .slice(0, 8)
      .map((product) => ({ product }));
  }, [deferredProductSearch, products]);

  const activeIndex = Math.min(activeSuggestionIndex, Math.max(suggestions.length - 1, 0));

  function enterEditMode() {
    setLines(buildLinesFromLoading(loading));
    setMode("edit");
  }

  function cancelEdit() {
    setLines(buildLinesFromLoading(loading));
    setProductSearch("");
    setSuggestionsOpen(false);
    setMode("view");
  }

  function updateLine(
    productId: string,
    updates: Partial<Pick<EditableLine, "initialLoadQuantity" | "reloadedQuantity" | "actualRemainingQuantity">>,
  ) {
    setLines((current) =>
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

  function removeLine(productId: string, productName: string) {
    if (!window.confirm(`Voulez-vous vraiment supprimer ${productName} du chargement ?`)) {
      return;
    }
    setLines((current) => current.filter((line) => line.productId !== productId));
  }

  function addProduct(product: ProductDto) {
    const existing = lines.find((line) => line.productId === product.id);
    if (existing) {
      toast.error("Ce produit existe deja dans ce chargement.");
      setProductSearch("");
      setSuggestionsOpen(false);
      return;
    }

    setLines((current) => [
      ...current,
      {
        productId: product.id,
        productName: product.name,
        productReference: product.reference,
        productBarcode: product.barcode,
        productUnit: product.unit,
        depotAvailableQuantity: 0,
        initialLoadQuantity: 0,
        reloadedQuantity: 0,
        actualRemainingQuantity: null,
        theoreticalDisplay: 0,
      },
    ]);
    setProductSearch("");
    setSuggestionsOpen(false);
    setActiveSuggestionIndex(0);
  }

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (suggestions.length === 0) return;
      setSuggestionsOpen(true);
      setActiveSuggestionIndex((current) => Math.min(current + 1, suggestions.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (suggestions.length === 0) return;
      setSuggestionsOpen(true);
      setActiveSuggestionIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (suggestions[activeIndex]) addProduct(suggestions[activeIndex].product);
    }
  }

  async function saveChanges() {
    if (lines.length === 0) {
      toast.error("Ajoutez au moins un produit.");
      return;
    }
    if (loading.status === "VALIDATED") {
      const missing = lines.find((line) => line.actualRemainingQuantity === null);
      if (missing) {
        toast.error("Veuillez saisir la quantite restante reelle pour tous les produits.");
        return;
      }
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/truck-loadings/${loading.id}/lines`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: lines.map((line) => ({
            productId: line.productId,
            initialQuantity: line.initialLoadQuantity,
            reloadedQuantity: line.reloadedQuantity,
            actualRemainingQuantity: line.actualRemainingQuantity,
          })),
        }),
      });
      const body = (await response.json()) as { loading?: TruckLoadingDto; message?: string };
      if (!response.ok || !body.loading) {
        toast.error(body.message ?? "Impossible d'enregistrer les modifications.");
        return;
      }

      setLoading(body.loading);
      setLines(buildLinesFromLoading(body.loading));
      setMode("view");
      toast.success(`Chargement ${body.loading.displayNumber} modifie avec succes.`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const totalQuantity = lines.reduce(
    (sum, line) => sum + line.initialLoadQuantity + line.reloadedQuantity,
    0,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-heading text-2xl font-semibold text-foreground">
              Chargement {loading.displayNumber}
            </h1>
            <LoadingStatusBadge status={loading.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {loading.driverName} - {loading.truckCode} - {loading.depotName}
          </p>
        </div>

        <div className="flex gap-2">
          {mode === "view" ? (
            <>
              <Button type="button" variant="outline" render={<Link href="/chargements" />}>
                <ArrowLeft className="h-4 w-4" />
                Retour a l&apos;historique
              </Button>
              <Button type="button" onClick={enterEditMode}>
                <Pencil className="h-4 w-4" />
                Modifier
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={cancelEdit}>
                Annuler
              </Button>
              <Button type="button" disabled={busy} onClick={saveChanges}>
                Enregistrer les modifications
              </Button>
            </>
          )}
        </div>
      </div>

      <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <InfoItem label="Chauffeur" value={loading.driverName} />
            <InfoItem label="Camion" value={loading.truckCode} />
            <InfoItem label="Depot" value={loading.depotName} />
            <InfoItem label="Date" value={new Date(loading.date).toLocaleDateString("fr-FR")} />
            <InfoItem
              label="Ouverture"
              value={new Date(loading.createdAt).toLocaleString("fr-FR")}
            />
            <InfoItem
              label="Fermeture"
              value={loading.closedAt ? new Date(loading.closedAt).toLocaleString("fr-FR") : "-"}
            />
            <InfoItem
              label="Modifie le"
              value={
                loading.updatedByUserName
                  ? `${new Date(loading.updatedAt).toLocaleString("fr-FR")} par ${loading.updatedByUserName}`
                  : "-"
              }
            />
            <InfoItem label="Nombre de produits" value={String(lines.length)} />
          </div>
        </CardContent>
      </Card>

      <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-lg font-semibold">Produits du chargement</h2>
            <p className="text-sm text-muted-foreground">Quantite totale : {totalQuantity}</p>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produit</TableHead>
                  <TableHead className="text-right">Stock depart</TableHead>
                  <TableHead className="text-right">Charge initiale</TableHead>
                  <TableHead className="text-right">Recharge</TableHead>
                  <TableHead className="text-right">Restant theorique</TableHead>
                  <TableHead className="text-right">Restant reel</TableHead>
                  {mode === "edit" ? <TableHead className="text-right">Action</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={mode === "edit" ? 7 : 6}
                      className="py-8 text-center text-muted-foreground"
                    >
                      Aucun produit dans ce chargement.
                    </TableCell>
                  </TableRow>
                ) : (
                  lines.map((line) => (
                    <TableRow key={line.productId}>
                      <TableCell>
                        <div className="font-medium">{line.productName}</div>
                        <div className="text-xs text-muted-foreground">
                          {line.productReference}
                          {line.productBarcode ? ` - ${line.productBarcode}` : ""}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {line.depotAvailableQuantity}
                      </TableCell>
                      <TableCell className="w-[130px] text-right tabular-nums">
                        {mode === "edit" ? (
                          <Input
                            type="number"
                            min={0}
                            value={String(line.initialLoadQuantity)}
                            onFocus={(event) => event.currentTarget.select()}
                            onChange={(event) =>
                              updateLine(line.productId, {
                                initialLoadQuantity: parseInteger(event.target.value, 0),
                              })
                            }
                          />
                        ) : (
                          line.initialLoadQuantity
                        )}
                      </TableCell>
                      <TableCell className="w-[130px] text-right tabular-nums">
                        {mode === "edit" ? (
                          <Input
                            type="number"
                            min={0}
                            value={String(line.reloadedQuantity)}
                            onFocus={(event) => event.currentTarget.select()}
                            onChange={(event) =>
                              updateLine(line.productId, {
                                reloadedQuantity: parseInteger(event.target.value, 0),
                              })
                            }
                          />
                        ) : (
                          line.reloadedQuantity
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {line.theoreticalDisplay}
                      </TableCell>
                      <TableCell className="w-[130px] text-right tabular-nums">
                        {mode === "edit" ? (
                          <Input
                            type="number"
                            min={0}
                            placeholder="A saisir"
                            value={
                              line.actualRemainingQuantity === null
                                ? ""
                                : String(line.actualRemainingQuantity)
                            }
                            onFocus={(event) => event.currentTarget.select()}
                            onChange={(event) =>
                              updateLine(line.productId, {
                                actualRemainingQuantity: parseIntegerOrNull(event.target.value),
                              })
                            }
                          />
                        ) : (
                          (line.actualRemainingQuantity ?? "-")
                        )}
                      </TableCell>
                      {mode === "edit" ? (
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeLine(line.productId, line.productName)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {mode === "edit" ? (
            <div className="space-y-3 rounded-2xl border border-border bg-muted/20 p-4">
              <p className="text-sm font-medium text-foreground">Ajouter un produit</p>
              <div className="relative max-w-lg">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={searchRef}
                  value={productSearch}
                  onChange={(event) => {
                    setProductSearch(event.target.value);
                    setSuggestionsOpen(true);
                    setActiveSuggestionIndex(0);
                  }}
                  onFocus={() => {
                    if (productSearch.trim()) setSuggestionsOpen(true);
                  }}
                  onBlur={() => {
                    window.setTimeout(() => setSuggestionsOpen(false), 120);
                  }}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Rechercher par nom, reference ou code-barres..."
                  className="pl-9"
                />

                {suggestionsOpen && suggestions.length > 0 ? (
                  <div className="absolute z-20 mt-2 w-full rounded-2xl border border-border bg-background p-2 shadow-lg">
                    <div className="max-h-80 overflow-y-auto">
                      {suggestions.map((suggestion, index) => (
                        <button
                          key={suggestion.product.id}
                          type="button"
                          className={`flex w-full flex-col rounded-xl px-3 py-2 text-left transition ${
                            index === activeIndex ? "bg-emerald-50 text-emerald-900" : "hover:bg-muted/60"
                          }`}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => addProduct(suggestion.product)}
                        >
                          <span className="font-medium">{suggestion.product.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {suggestion.product.reference}
                            {suggestion.product.barcode ? ` - ${suggestion.product.barcode}` : ""}
                            {` - ${suggestion.product.unit}`}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <p className="mt-1 text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

function LoadingStatusBadge({ status }: { status: string }) {
  const variant = status === "CANCELLED" ? "destructive" : status === "VALIDATED" ? "secondary" : "default";
  return <Badge variant={variant}>{loadingStatusLabels[status] ?? status}</Badge>;
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
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
