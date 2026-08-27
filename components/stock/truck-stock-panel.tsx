"use client";

import * as React from "react";
import { Pencil, Plus, Search, Truck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn, formatCurrency } from "@/lib/utils";
import type { StockAdjustmentInput, StockLevelDto, StockLocationDto } from "@/types/operations-dto";
import type { ProductDto } from "@/types/product-dto";

type TruckStockPanelProps = {
  locations: StockLocationDto[];
  rows: StockLevelDto[];
  products: ProductDto[];
  onAdjusted: () => void;
};

type AdjustmentReason =
  | "Inventaire reel"
  | "Erreur de saisie"
  | "Casse"
  | "Perte"
  | "Retour"
  | "Correction administrative"
  | "Autre";

type AdjustmentTarget = {
  productId: string;
  productName: string;
  productReference: string;
  currentQuantity: number;
};

const adjustmentReasons: AdjustmentReason[] = [
  "Inventaire reel",
  "Erreur de saisie",
  "Casse",
  "Perte",
  "Retour",
  "Correction administrative",
  "Autre",
];

type AdjustmentDialogState = {
  open: boolean;
  productId: string;
  currentQuantity: number;
  targetQuantity: string;
  reason: AdjustmentReason;
  customReason: string;
  note: string;
  confirmActiveTour: boolean;
  errors: Record<string, string>;
  saving: boolean;
};

const defaultDialogState: AdjustmentDialogState = {
  open: false,
  productId: "",
  currentQuantity: 0,
  targetQuantity: "0",
  reason: "Inventaire reel",
  customReason: "",
  note: "",
  confirmActiveTour: false,
  errors: {},
  saving: false,
};

export function TruckStockPanel({
  locations,
  rows,
  products,
  onAdjusted,
}: TruckStockPanelProps) {
  const [selectedLocationId, setSelectedLocationId] = React.useState(
    locations[0]?.id ?? "",
  );
  const [productSearch, setProductSearch] = React.useState("");
  const [dialogState, setDialogState] = React.useState<AdjustmentDialogState>(defaultDialogState);

  const selectedLocation =
    locations.find((location) => location.id === selectedLocationId) ?? null;

  const selectedRows = React.useMemo(
    () =>
      rows
        .filter((row) => row.locationId === selectedLocationId)
        .sort((left, right) => left.productName.localeCompare(right.productName, "fr-FR")),
    [rows, selectedLocationId],
  );

  const selectedRowByProductId = React.useMemo(
    () => new Map(selectedRows.map((row) => [row.productId, row])),
    [selectedRows],
  );

  const filteredProducts = React.useMemo(() => {
    const query = normalizeSearch(productSearch);
    if (!query) {
      return products
        .filter((product) => product.status === "ACTIVE")
        .sort((left, right) => left.name.localeCompare(right.name, "fr-FR"));
    }

    return products
      .filter((product) => product.status === "ACTIVE")
      .filter((product) =>
        normalizeSearch(
          `${product.name} ${product.reference} ${product.barcode ?? ""}`,
        ).includes(query),
      )
      .sort((left, right) => left.name.localeCompare(right.name, "fr-FR"));
  }, [productSearch, products]);

  function openAdjustmentDialog(target: AdjustmentTarget) {
    setDialogState({
      ...defaultDialogState,
      open: true,
      productId: target.productId,
      currentQuantity: target.currentQuantity,
      targetQuantity: String(target.currentQuantity),
    });
  }

  function updateDialogState<K extends keyof AdjustmentDialogState>(
    key: K,
    value: AdjustmentDialogState[K],
  ) {
    setDialogState((current) => ({
      ...current,
      [key]: value,
      errors: { ...current.errors, [key]: "", form: "" },
    }));
  }

  function closeDialog() {
    setDialogState(defaultDialogState);
  }

  async function submitAdjustment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedLocation) {
      toast.error("Selectionnez d'abord un camion.");
      return;
    }

    const targetQuantity = Number(dialogState.targetQuantity);
    const resolvedReason =
      dialogState.reason === "Autre"
        ? dialogState.customReason.trim()
        : dialogState.reason;

    setDialogState((current) => ({
      ...current,
      saving: true,
      errors: { ...current.errors, form: "" },
    }));

    const payload: StockAdjustmentInput = {
      productId: dialogState.productId,
      locationId: selectedLocation.id,
      quantity: 0,
      targetQuantity,
      adjustmentMode: "SET",
      reason: resolvedReason,
      note: dialogState.note.trim() || null,
      reference: selectedLocation.code,
      confirmActiveTour: dialogState.confirmActiveTour,
    };

    const response = await fetch("/api/stock/adjustments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const result = (await response.json()) as {
      level?: StockLevelDto;
      message?: string;
      fieldErrors?: Record<string, string>;
    };

    if (!response.ok || !result.level) {
      const fieldErrors = result.fieldErrors ?? {};
      setDialogState((current) => ({
        ...current,
        saving: false,
        errors: {
          ...fieldErrors,
          form: result.message ?? current.errors.form,
        },
      }));
      return;
    }

    toast.success("Ajustement de stock enregistre.");
    onAdjusted();
    closeDialog();
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        {locations.map((location) => {
          const locationRows = rows.filter((row) => row.locationId === location.id);
          const totalQuantity = locationRows.reduce((sum, row) => sum + row.quantity, 0);
          const totalValue = locationRows.reduce((sum, row) => sum + row.stockValue, 0);
          const selected = selectedLocationId === location.id;

          return (
            <button
              key={location.id}
              type="button"
              onClick={() => setSelectedLocationId(location.id)}
              className={cn(
                "rounded-xl border bg-background p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_30px_rgba(15,23,42,0.08)] focus-visible:border-emerald-500 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-emerald-500/15",
                selected
                  ? "border-emerald-300 ring-3 ring-emerald-500/10"
                  : "border-border",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-heading text-base font-semibold text-foreground">
                    {location.name}
                  </p>
                  <p className="text-xs text-muted-foreground">{location.code}</p>
                </div>
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
                  <Truck aria-hidden="true" className="h-5 w-5" />
                </span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Quantite</p>
                  <p className="font-semibold tabular-nums">{totalQuantity}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Valeur</p>
                  <p className="font-semibold tabular-nums">
                    {formatCurrency(totalValue)}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <Card className="ring-0 shadow-none">
        <CardContent className="space-y-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="font-heading text-lg font-semibold text-foreground">
                Stock du camion
              </h2>
              <p className="text-sm text-muted-foreground">
                Ajustez ici le stock reel du camion. Chaque correction cree un mouvement
                immuable d&apos;inventaire.
              </p>
            </div>

            <div className="w-full max-w-xl rounded-2xl border border-border/70 bg-muted/25 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Plus className="h-4 w-4 text-emerald-700" />
                Ajouter / ajuster un produit
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_180px]">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={productSearch}
                    onChange={(event) => setProductSearch(event.target.value)}
                    placeholder="Nom, reference ou code-barres..."
                    className="pl-9"
                  />
                </div>
                <Select
                  value={dialogState.open ? dialogState.productId : null}
                  onValueChange={(value) => {
                    const product = products.find((item) => item.id === value);
                    if (!product) {
                      return;
                    }
                    const existingRow = selectedRowByProductId.get(product.id);
                    openAdjustmentDialog({
                      productId: product.id,
                      productName: product.name,
                      productReference: product.reference,
                      currentQuantity: existingRow?.quantity ?? 0,
                    });
                  }}
                >
                  <SelectTrigger className="h-10 w-full">
                    <SelectValue placeholder="Choisir un produit" />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredProducts.map((product) => (
                      <SelectItem key={product.id} value={product.id}>
                        {product.reference} - {product.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produit</TableHead>
                <TableHead className="text-right">Quantite</TableHead>
                <TableHead className="text-right">Disponible</TableHead>
                <TableHead className="text-right">Valeur</TableHead>
                <TableHead className="text-right">Derniere MAJ</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {selectedRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    Aucun produit n&apos;est encore enregistre dans ce camion.
                  </TableCell>
                </TableRow>
              ) : (
                selectedRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="font-medium text-foreground">{row.productName}</div>
                      <div className="text-xs text-muted-foreground">{row.productReference}</div>
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {row.quantity}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.availableQuantity}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(row.stockValue)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {new Date(row.updatedAt).toLocaleDateString("fr-FR")}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          openAdjustmentDialog({
                            productId: row.productId,
                            productName: row.productName,
                            productReference: row.productReference,
                            currentQuantity: row.quantity,
                          })
                        }
                      >
                        <Pencil className="h-4 w-4" />
                        Ajuster
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogState.open} onOpenChange={(open) => (!open ? closeDialog() : null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Modifier le stock</DialogTitle>
            <DialogDescription>
              Ajustez le stock reel du camion selectionne sans toucher aux chargements
              ni aux ventes historiques.
            </DialogDescription>
          </DialogHeader>

          <form className="space-y-4" onSubmit={submitAdjustment}>
            {dialogState.errors.form ? (
              <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {dialogState.errors.form}
              </div>
            ) : null}

            {dialogState.errors.confirmActiveTour || dialogState.confirmActiveTour ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <div className="flex items-start gap-2">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-medium">Ce camion a une tournee en cours.</p>
                    <p className="mt-1 text-amber-800">
                      Confirmez l&apos;ajustement du stock pendant la tournee si vous souhaitez
                      continuer.
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            <DetailField
              label="Produit"
              value={
                products.find((product) => product.id === dialogState.productId)?.name ?? "-"
              }
              secondary={
                products.find((product) => product.id === dialogState.productId)?.reference ?? null
              }
            />

            <DetailField
              label="Camion"
              value={selectedLocation?.name ?? "-"}
              secondary={selectedLocation?.code ?? null}
            />

            <DetailField
              label="Stock actuel"
              value={String(dialogState.currentQuantity)}
            />

            <Field
              label="Nouvelle quantite reelle"
              error={dialogState.errors.targetQuantity}
            >
              <Input
                type="number"
                min={0}
                value={dialogState.targetQuantity}
                onChange={(event) =>
                  updateDialogState("targetQuantity", event.target.value)
                }
              />
            </Field>

            <Field label="Motif de l'ajustement" error={dialogState.errors.reason}>
              <Select
                value={dialogState.reason}
                onValueChange={(value) =>
                  updateDialogState("reason", value as AdjustmentReason)
                }
              >
                <SelectTrigger className="h-10 w-full">
                  <SelectValue placeholder="Choisir un motif" />
                </SelectTrigger>
                <SelectContent>
                  {adjustmentReasons.map((reason) => (
                    <SelectItem key={reason} value={reason}>
                      {reason}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {dialogState.reason === "Autre" ? (
              <Field label="Preciser le motif" error={dialogState.errors.reason}>
                <Input
                  value={dialogState.customReason}
                  onChange={(event) =>
                    updateDialogState("customReason", event.target.value)
                  }
                  placeholder="Motif detaille"
                />
              </Field>
            ) : null}

            <Field label="Note">
              <Textarea
                value={dialogState.note}
                onChange={(event) => updateDialogState("note", event.target.value)}
                placeholder="Optionnel"
              />
            </Field>

            {dialogState.errors.confirmActiveTour || dialogState.confirmActiveTour ? (
              <label className="flex items-start gap-3 rounded-2xl border border-border/70 bg-muted/20 px-4 py-3 text-sm">
                <input
                  type="checkbox"
                  checked={dialogState.confirmActiveTour}
                  onChange={(event) =>
                    updateDialogState("confirmActiveTour", event.target.checked)
                  }
                  className="mt-1"
                />
                <span>
                  Confirmer l&apos;ajustement du stock pendant la tournee.
                </span>
              </label>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialog}>
                Annuler
              </Button>
              <Button type="submit" disabled={dialogState.saving}>
                {dialogState.saving ? "Enregistrement..." : "Enregistrer l'ajustement"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function DetailField({
  label,
  value,
  secondary,
}: {
  label: string;
  value: string;
  secondary?: string | null;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-muted/20 px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium text-foreground">{value}</p>
      {secondary ? <p className="mt-1 text-xs text-muted-foreground">{secondary}</p> : null}
    </div>
  );
}

function normalizeSearch(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
