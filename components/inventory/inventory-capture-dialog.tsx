"use client";

import * as React from "react";
import { CheckCircle2, Lock } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { InventoryStatusBadge } from "@/components/inventory/inventory-status-badge";
import { formatCurrency } from "@/lib/utils";
import type { InventoryDto, InventoryLineDto, StockLevelDto } from "@/types/operations-dto";
import type { ProductDto } from "@/types/product-dto";

type InventoryTotals = {
  linesCount: number;
  totalValue: number;
  totalStockBefore: number;
  totalDifference: number;
};

type InventoryCaptureDialogProps = {
  inventory: InventoryDto | null;
  mode: "capture" | "view";
  products: ProductDto[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInventoryUpdated: (inventory: InventoryDto) => void;
};

function computeTotals(lines: InventoryLineDto[]): InventoryTotals {
  return lines.reduce(
    (totals, line) => {
      totals.linesCount += 1;
      totals.totalValue = roundMoney(totals.totalValue + line.lineValue);
      totals.totalStockBefore += line.stockBefore;
      totals.totalDifference += line.differenceQuantity;
      return totals;
    },
    { linesCount: 0, totalValue: 0, totalStockBefore: 0, totalDifference: 0 },
  );
}

export function InventoryCaptureDialog({
  inventory,
  mode,
  products,
  open,
  onOpenChange,
  onInventoryUpdated,
}: InventoryCaptureDialogProps) {
  const readOnly = mode === "view" || inventory?.status === "TERMINE";

  const [lines, setLines] = React.useState<InventoryLineDto[]>(inventory?.lines ?? []);
  const [syncedInventoryId, setSyncedInventoryId] = React.useState<string | null>(null);
  const [stockByProductId, setStockByProductId] = React.useState<Record<string, number>>({});
  const [finishing, setFinishing] = React.useState(false);

  const [productQuery, setProductQuery] = React.useState("");
  const [selectedProduct, setSelectedProduct] = React.useState<ProductDto | null>(null);
  const [quantityInput, setQuantityInput] = React.useState("");
  const [suggestionsOpen, setSuggestionsOpen] = React.useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = React.useState(0);
  const [saving, setSaving] = React.useState(false);
  const savingRef = React.useRef(false);

  const productInputRef = React.useRef<HTMLInputElement | null>(null);
  const quantityInputRef = React.useRef<HTMLInputElement | null>(null);

  // The dialog mounts its content (including the product input) inside a
  // portal at open-time, so a plain useEffect can fire before that DOM node
  // exists - a callback ref instead focuses the input at the exact instant
  // it is created, with no race against the dialog's own mount/animation
  // timing. Only relevant on the entry row's *first* mount (dialog opening,
  // or resuming a draft); later refocuses (after selecting a product or
  // saving a line) are handled by the effects below instead, since the
  // node already exists by then.
  const setProductInputRef = React.useCallback(
    (node: HTMLInputElement | null) => {
      productInputRef.current = node;
      if (node && open && !readOnly) {
        node.focus();
        // The dialog's own focus-trap setup (a layout/passive effect further
        // up the tree) can still steal focus back to itself right after this
        // ref callback runs. Re-assert focus one frame later, once that
        // setup has settled, so the product field reliably wins the race.
        requestAnimationFrame(() => {
          if (productInputRef.current === node) node.focus();
        });
      }
    },
    [open, readOnly],
  );

  // Mirrors inventory.lines whenever a *different* inventory is opened, but
  // never overwrites in-progress local edits on every render (React's
  // documented "adjust state during render" pattern instead of an effect).
  if (inventory && inventory.id !== syncedInventoryId) {
    setSyncedInventoryId(inventory.id);
    setLines(inventory.lines);
  } else if (!inventory && syncedInventoryId !== null) {
    setSyncedInventoryId(null);
    setLines([]);
  }

  React.useEffect(() => {
    if (!inventory || !open) return;
    let active = true;
    fetch(`/api/stock/depot/${inventory.depotId}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((body: { levels?: StockLevelDto[] }) => {
        if (!active) return;
        setStockByProductId(
          Object.fromEntries((body.levels ?? []).map((level) => [level.productId, level.quantity])),
        );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [inventory, open]);

  const totals = React.useMemo(() => computeTotals(lines), [lines]);

  const linesByProductId = React.useMemo(
    () => new Map(lines.map((line) => [line.productId, line])),
    [lines],
  );

  const suggestions = React.useMemo(() => {
    const query = normalizeSearch(productQuery);
    if (!query) return [];
    return products
      .filter((product) => {
        const haystack = normalizeSearch(
          `${product.name} ${product.reference} ${product.barcode ?? ""}`,
        );
        return haystack.includes(query);
      })
      .slice(0, 8);
  }, [productQuery, products]);

  const activeIndex = Math.min(activeSuggestionIndex, Math.max(suggestions.length - 1, 0));

  // A product is picked (or the row is reset) inside the same synchronous
  // handler that still has `disabled` set on the target field from the
  // previous render - the browser refuses to focus a disabled element, so
  // focusing must wait for the *next* render (post-commit), not happen
  // inline. useEffect is the correct tool here: it always runs after React
  // has flushed the DOM update that clears `disabled`.
  React.useEffect(() => {
    if (selectedProduct && !saving) {
      quantityInputRef.current?.focus();
      quantityInputRef.current?.select();
    }
  }, [selectedProduct, saving]);

  React.useEffect(() => {
    if (!selectedProduct && !saving && open && !readOnly) {
      productInputRef.current?.focus();
    }
  }, [selectedProduct, saving, open, readOnly]);

  function selectProduct(product: ProductDto) {
    setSelectedProduct(product);
    setProductQuery(`${product.name} (${product.reference})`);
    setSuggestionsOpen(false);
    setActiveSuggestionIndex(0);

    const existing = linesByProductId.get(product.id);
    if (existing) {
      setQuantityInput(String(existing.physicalQuantity));
      toast.info("Ce produit existe deja dans cet inventaire - quantite prete a corriger.");
    } else {
      setQuantityInput("");
    }
  }

  function resolveExactMatch(query: string) {
    const normalized = normalizeSearch(query);
    if (!normalized) return null;
    return (
      products.find((product) => normalizeSearch(product.barcode ?? "") === normalized) ??
      products.find((product) => normalizeSearch(product.reference) === normalized) ??
      null
    );
  }

  function handleProductKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
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
    if (event.key !== "Enter") return;
    event.preventDefault();

    // Exact barcode/reference match wins outright - this is what makes a USB
    // scanner (types the code, then sends Enter) work with zero extra logic.
    const exactMatch = resolveExactMatch(productQuery);
    if (exactMatch) {
      selectProduct(exactMatch);
      return;
    }
    if (suggestionsOpen && suggestions[activeIndex]) {
      selectProduct(suggestions[activeIndex]);
      return;
    }
    if (suggestions.length === 1) {
      selectProduct(suggestions[0]);
      return;
    }
    if (suggestions.length === 0 && productQuery.trim()) {
      toast.error("Produit introuvable.");
    }
  }

  function resetDraftRow() {
    setSelectedProduct(null);
    setProductQuery("");
    setQuantityInput("");
    setSuggestionsOpen(false);
    setActiveSuggestionIndex(0);
  }

  async function handleQuantityKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (!inventory || readOnly) return;
    if (savingRef.current) return; // guards against double-Enter firing two saves

    if (!selectedProduct) {
      toast.error("Selectionnez un produit avant de saisir la quantite.");
      return;
    }

    // Explicit validation: "" is empty, but 0 is a perfectly valid count and
    // must never be rejected by a truthy check.
    const trimmed = quantityInput.trim();
    if (trimmed === "") {
      toast.error("Saisissez la quantite physique.");
      return;
    }
    const physicalQuantity = Number(trimmed);
    if (!Number.isInteger(physicalQuantity) || physicalQuantity < 0) {
      toast.error("La quantite doit etre un nombre entier positif ou nul.");
      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      const response = await fetch(`/api/inventories/${inventory.id}/lines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: selectedProduct.id, physicalQuantity }),
      });
      const body = (await response.json()) as {
        line?: InventoryLineDto;
        totals?: InventoryTotals;
        message?: string;
      };
      if (!response.ok || !body.line) {
        toast.error(body.message ?? "Impossible d'enregistrer la ligne.");
        return;
      }

      const savedLine = body.line;
      const savedTotals = body.totals;
      setLines((current) => {
        const exists = current.some((line) => line.productId === savedLine.productId);
        const nextLines = exists
          ? current.map((line) => (line.productId === savedLine.productId ? savedLine : line))
          : [...current, savedLine];
        // Push the fresh totals up to the history table / top-of-page stat
        // cards immediately - they must reflect progress after every line,
        // not just at creation or finalization.
        if (savedTotals) {
          onInventoryUpdated({
            ...inventory,
            lines: nextLines,
            linesCount: savedTotals.linesCount,
            totalValue: savedTotals.totalValue,
            totalStockBefore: savedTotals.totalStockBefore,
            totalDifference: savedTotals.totalDifference,
          });
        }
        return nextLines;
      });

      resetDraftRow();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function handleFinish() {
    if (!inventory) return;
    if (lines.length === 0) {
      toast.error("Ajoutez au moins un produit avant de terminer l'inventaire.");
      return;
    }
    setFinishing(true);
    try {
      const response = await fetch(`/api/inventories/${inventory.id}/finish`, {
        method: "POST",
      });
      const body = (await response.json()) as { inventory?: InventoryDto; message?: string };
      if (!response.ok || !body.inventory) {
        toast.error(body.message ?? "Impossible de terminer l'inventaire.");
        return;
      }
      toast.success(`${body.inventory.displayNumber} termine - stock corrige.`);
      onInventoryUpdated(body.inventory);
      onOpenChange(false);
    } finally {
      setFinishing(false);
    }
  }

  const previewStock = selectedProduct ? stockByProductId[selectedProduct.id] ?? 0 : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-4xl">
        {inventory ? (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2">
                <DialogTitle className="text-xl">{inventory.displayNumber}</DialogTitle>
                <InventoryStatusBadge status={inventory.status} />
              </div>
              <DialogDescription>
                {inventory.depotName} -{" "}
                {new Date(inventory.createdAt).toLocaleDateString("fr-FR")}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3 sm:grid-cols-4">
              <MetricBlock label="Lignes saisies" value={String(totals.linesCount)} />
              <MetricBlock label="Valeur inventaire" value={formatCurrency(totals.totalValue)} />
              <MetricBlock label="Stock avant" value={String(totals.totalStockBefore)} />
              <MetricBlock label="Difference" value={String(totals.totalDifference)} />
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-1 py-1">
              <div className="overflow-x-auto rounded-2xl border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produit</TableHead>
                      <TableHead className="text-right">Prix d&apos;achat</TableHead>
                      <TableHead className="text-right">Stock avant</TableHead>
                      <TableHead className="text-right">Quantite physique</TableHead>
                      <TableHead className="text-right">Difference</TableHead>
                      <TableHead className="text-right">Valeur ligne</TableHead>
                      <TableHead className="w-8" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell>
                          <div className="font-medium">{line.productName}</div>
                          <div className="text-xs text-muted-foreground">
                            {line.productReference}
                            {line.productBarcode ? ` - ${line.productBarcode}` : ""}
                            {` - ${line.productUnit}`}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(line.unitCost)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {line.stockBefore}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {line.physicalQuantity}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${
                            line.differenceQuantity < 0
                              ? "text-red-600"
                              : line.differenceQuantity > 0
                                ? "text-emerald-700"
                                : ""
                          }`}
                        >
                          {line.differenceQuantity > 0 ? "+" : ""}
                          {line.differenceQuantity}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(line.lineValue)}
                        </TableCell>
                        <TableCell>
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        </TableCell>
                      </TableRow>
                    ))}

                    {!readOnly ? (
                      <TableRow>
                        <TableCell className="relative">
                          <Input
                            ref={setProductInputRef}
                            value={productQuery}
                            disabled={saving}
                            placeholder="Rechercher ou scanner un produit..."
                            onChange={(event) => {
                              setProductQuery(event.target.value);
                              setSelectedProduct(null);
                              setSuggestionsOpen(true);
                              setActiveSuggestionIndex(0);
                            }}
                            onFocus={() => {
                              if (productQuery.trim()) setSuggestionsOpen(true);
                            }}
                            onBlur={() => {
                              window.setTimeout(() => setSuggestionsOpen(false), 120);
                            }}
                            onKeyDown={handleProductKeyDown}
                          />
                          {suggestionsOpen && suggestions.length > 0 ? (
                            <div className="absolute z-20 mt-1 w-full min-w-[280px] rounded-2xl border border-border bg-background p-2 shadow-lg">
                              <div className="max-h-72 overflow-y-auto">
                                {suggestions.map((product, index) => (
                                  <button
                                    key={product.id}
                                    type="button"
                                    className={`flex w-full flex-col rounded-xl px-3 py-2 text-left transition ${
                                      index === activeIndex
                                        ? "bg-emerald-50 text-emerald-900"
                                        : "hover:bg-muted/60"
                                    }`}
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => selectProduct(product)}
                                  >
                                    <span className="font-medium">{product.name}</span>
                                    <span className="text-xs text-muted-foreground">
                                      {product.reference}
                                      {product.barcode ? ` - ${product.barcode}` : ""}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {selectedProduct ? formatCurrency(selectedProduct.purchasePrice) : "-"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {previewStock ?? "-"}
                        </TableCell>
                        <TableCell>
                          <Input
                            ref={quantityInputRef}
                            type="number"
                            min={0}
                            value={quantityInput}
                            disabled={!selectedProduct || saving}
                            placeholder="Quantite"
                            onFocus={(event) => event.currentTarget.select()}
                            onChange={(event) => setQuantityInput(event.target.value)}
                            onKeyDown={handleQuantityKeyDown}
                            className="text-right"
                          />
                        </TableCell>
                        <TableCell colSpan={3} />
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>

              {readOnly ? (
                <div className="flex items-center gap-2 rounded-2xl border border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                  <Lock className="h-4 w-4" />
                  Inventaire termine, lecture seule.
                </div>
              ) : null}
            </div>

            <DialogFooter className="flex-row items-center justify-between sm:justify-between">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Fermer
              </Button>
              {!readOnly ? (
                <Button type="button" disabled={finishing} onClick={handleFinish}>
                  Terminer l&apos;inventaire
                </Button>
              ) : null}
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function MetricBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground tabular-nums">{value}</p>
    </div>
  );
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
