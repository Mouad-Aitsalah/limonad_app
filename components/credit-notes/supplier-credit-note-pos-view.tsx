"use client";

import * as React from "react";
import { toast } from "sonner";

import { CommerceProductGrid } from "@/components/commerce/product-grid";
import { CommerceProductSearch } from "@/components/commerce/product-search";
import { useProductPickerSearch } from "@/components/commerce/use-product-picker-search";
import { CreditNoteCart } from "@/components/credit-notes/credit-note-cart";
import { CreditNoteSummary } from "@/components/credit-notes/credit-note-summary";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { creditNoteReasonLabels } from "@/lib/credit-note-calculations";
import { roundMoney } from "@/lib/money";
import type { CurrentUser } from "@/types/auth";
import type {
  CreditNote,
  CreditNoteReason,
  CreateCreditNoteInput,
} from "@/types/credit-note";
import type { StockLocationDto, SupplierPartnerDto } from "@/types/operations-dto";
import type { ProductDto } from "@/types/product-dto";

type CartLine = {
  productId: string;
  // Phase 3 CRITICAL #1 fix: captured once, from the full ProductDto
  // available at the moment a product is picked (addProduct) or from the
  // draft's own already-saved line (editing mode) - see
  // credit-note-pos-view.tsx's identical fix for the full rationale.
  productName: string;
  productReference: string;
  productUnit: string;
  quantityReturned: number;
  unitPrice: number;
  discountPercent: number;
  taxRate: number;
};

type SupplierCreditNotePosViewProps = {
  suppliers: SupplierPartnerDto[];
  products: ProductDto[];
  locations: StockLocationDto[];
  currentUser: CurrentUser;
  editingCreditNote?: CreditNote | null;
  onSaved: (creditNote: CreditNote) => void;
  onClearEditing: () => void;
};

const reasonOptions: CreditNoteReason[] = [
  "produit_defectueux",
  "produit_endommage",
  "erreur_fournisseur",
  "produit_non_conforme",
  "surplus_livraison",
  "retour_commercial",
  "produit_perime",
  "autre",
];

export function SupplierCreditNotePosView({
  suppliers,
  products,
  locations,
  currentUser,
  editingCreditNote,
  onSaved,
  onClearEditing,
}: SupplierCreditNotePosViewProps) {
  const activeLocations = React.useMemo(
    () =>
      [...locations]
        .filter((location) => location.active)
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === "DEPOT" ? -1 : 1;
          return a.name.localeCompare(b.name, "fr-FR");
        }),
    [locations],
  );

  const defaultSourceId = React.useMemo(
    () =>
      activeLocations.find(
        (location) =>
          location.type === "DEPOT" &&
          normalizeSearch(`${location.name} ${location.code}`).includes("principal"),
      )?.id ??
      activeLocations.find((location) => location.type === "DEPOT")?.id ??
      activeLocations[0]?.id ??
      "",
    [activeLocations],
  );

  const initialFormState = createFormState(editingCreditNote, defaultSourceId);

  const [search, setSearch] = React.useState(initialFormState.search);
  const [supplierSearch, setSupplierSearch] = React.useState(initialFormState.supplierSearch);
  const [supplierId, setSupplierId] = React.useState(initialFormState.supplierId);
  const [returnDate, setReturnDate] = React.useState(initialFormState.returnDate);
  const [sourceLocationId, setSourceLocationId] = React.useState(initialFormState.sourceLocationId);
  const [reason, setReason] = React.useState<CreditNoteReason>(initialFormState.reason);
  const [comment, setComment] = React.useState(initialFormState.comment);
  const [cart, setCart] = React.useState<CartLine[]>(initialFormState.cart);
  const [busy, setBusy] = React.useState(false);

  const selectedSupplier = suppliers.find((supplier) => supplier.id === supplierId) ?? null;
  const selectedSource =
    activeLocations.find((location) => location.id === sourceLocationId) ?? null;

  // Phase 3 CRITICAL #1 fix: `products` (the server-rendered preload) is
  // org-wide, not supplier-scoped - re-fetch a small supplier-scoped
  // preload the instant a supplier is picked, same fallback rule
  // (unscoped if that supplier has zero products) the old client-side
  // filter used over the full catalog. See GET /api/products/preload's
  // doc comment.
  const [supplierPreload, setSupplierPreload] = React.useState<{
    supplierId: string;
    products: ProductDto[];
  } | null>(null);

  React.useEffect(() => {
    if (!selectedSupplier) return;
    let cancelled = false;
    fetch(`/api/products/preload?supplierId=${encodeURIComponent(selectedSupplier.id)}`)
      .then((response) => (response.ok ? response.json() : { products: [] }))
      .then((body: { products?: ProductDto[] }) => {
        if (!cancelled) setSupplierPreload({ supplierId: selectedSupplier.id, products: body.products ?? [] });
      })
      .catch(() => {
        if (!cancelled) setSupplierPreload({ supplierId: selectedSupplier.id, products: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSupplier]);

  const activeProducts =
    selectedSupplier && supplierPreload?.supplierId === selectedSupplier.id
      ? supplierPreload.products
      : products;

  const filteredSuppliers = React.useMemo(() => {
    const query = normalizeSearch(supplierSearch);
    if (!query) return suppliers.slice(0, 25);
    return suppliers
      .filter((supplier) =>
        normalizeSearch(
          `${supplier.name} ${supplier.code} ${supplier.phone ?? ""} ${supplier.ice ?? ""}`,
        ).includes(query),
      )
      .slice(0, 25);
  }, [supplierSearch, suppliers]);

  // Phase 3 CRITICAL #1 fix: server-side search (scoped to the selected
  // supplier, same fallback rule as the preload above) replaces the old
  // client-side filter over the full catalog.
  const { results: filteredProducts } = useProductPickerSearch(activeProducts, search, {
    supplierId: selectedSupplier?.id,
  });

  // No product lookup needed here anymore - every CartLine already carries
  // its own display fields, captured once at addProduct() time or from the
  // draft's own saved line (see CartLine's doc comment).
  const cartLines = React.useMemo(() => {
    return cart.map((line) => {
      const baseHT = line.unitPrice * line.quantityReturned;
      const discountAmount = baseHT * (line.discountPercent / 100);
      const totalHT = roundMoney(baseHT - discountAmount);
      const taxAmount = roundMoney(totalHT * (line.taxRate / 100));
      const totalTTC = roundMoney(totalHT + taxAmount);

      return {
        ...line,
        totalHT,
        discountAmount: roundMoney(discountAmount),
        taxAmount,
        totalTTC,
      };
    });
  }, [cart]);

  const totals = React.useMemo(() => {
    return cartLines.reduce(
      (acc, line) => {
        acc.totalHT += line.totalHT;
        acc.discountAmount += line.discountAmount;
        acc.taxAmount += line.taxAmount;
        acc.totalTTC += line.totalTTC;
        return acc;
      },
      { totalHT: 0, discountAmount: 0, taxAmount: 0, totalTTC: 0 },
    );
  }, [cartLines]);

  const resetForm = React.useCallback((nextSourceId = defaultSourceId) => {
    setSearch("");
    setSupplierSearch("");
    setSupplierId("");
    setReturnDate(todayDateInput());
    setSourceLocationId(nextSourceId);
    setReason("produit_defectueux");
    setComment("");
    setCart([]);
  }, [defaultSourceId]);

  function addProduct(product: ProductDto) {
    setCart((current) => {
      const existing = current.find((line) => line.productId === product.id);
      if (existing) {
        return current.map((line) =>
          line.productId === product.id
            ? { ...line, quantityReturned: line.quantityReturned + 1 }
            : line,
        );
      }

      return [
        ...current,
        {
          productId: product.id,
          productName: product.name,
          productReference: product.reference,
          productUnit: product.unit,
          quantityReturned: 1,
          unitPrice: product.purchasePrice,
          discountPercent: 0,
          taxRate: product.taxRate,
        },
      ];
    });
  }

  function updateLine(productId: string, updates: Partial<CartLine>) {
    setCart((current) =>
      current.map((line) => (line.productId === productId ? { ...line, ...updates } : line)),
    );
  }

  function incrementQuantity(productId: string) {
    updateLine(productId, {
      quantityReturned:
        (cart.find((line) => line.productId === productId)?.quantityReturned ?? 0) + 1,
    });
  }

  function decrementQuantity(productId: string) {
    setCart((current) => {
      const line = current.find((item) => item.productId === productId);
      if (!line) return current;
      if (line.quantityReturned <= 1) {
        return current.filter((item) => item.productId !== productId);
      }
      return current.map((item) =>
        item.productId === productId
          ? { ...item, quantityReturned: item.quantityReturned - 1 }
          : item,
      );
    });
  }

  function removeLine(productId: string) {
    setCart((current) => current.filter((line) => line.productId !== productId));
  }

  async function submit(mode: "draft" | "validate") {
    if (!selectedSupplier) {
      toast.error("Selectionnez un fournisseur.");
      return;
    }
    if (!selectedSource) {
      toast.error("Selectionnez le stock source.");
      return;
    }
    if (cartLines.length === 0) {
      toast.error("Ajoutez au moins un produit dans le panier.");
      return;
    }
    if (reason === "autre" && comment.trim().length === 0) {
      toast.error("La justification est obligatoire pour le motif Autre.");
      return;
    }

    const payload: CreateCreditNoteInput = {
      id: editingCreditNote?.id,
      partyType: "fournisseur",
      supplierId: selectedSupplier.id,
      reason,
      comment,
      returnDate,
      stockSourceLocationId: selectedSource.id,
      lines: cartLines.map((line) => ({
        productId: line.productId,
        quantityReturned: line.quantityReturned,
        unitPrice: line.unitPrice,
        discountPercent: line.discountPercent,
        taxRate: line.taxRate,
      })),
    };

    setBusy(true);
    try {
      const response = await fetch(
        mode === "draft" ? "/api/credit-notes/draft" : "/api/credit-notes/manual",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const body = (await response.json()) as { creditNote?: CreditNote; message?: string };
      if (!response.ok || !body.creditNote) {
        toast.error(body.message ?? "Impossible d'enregistrer l'avoir fournisseur.");
        return;
      }

      onSaved(body.creditNote);
      onClearEditing();
      resetForm();
      toast.success(
        mode === "draft"
          ? "Avoir fournisseur enregistre comme brouillon."
          : "Avoir fournisseur valide avec succes.",
      );
    } finally {
      setBusy(false);
    }
  }

  const isEditing = Boolean(editingCreditNote);

  return (
    <div className="grid gap-4 lg:h-[calc(100vh-11rem)] lg:grid-cols-2 lg:gap-6">
      <div className="flex flex-col gap-4 lg:h-full lg:overflow-hidden">
        <CommerceProductSearch value={search} onChange={setSearch} />
        <div className="lg:flex-1 lg:overflow-y-auto lg:pr-1">
          <CommerceProductGrid
            products={filteredProducts}
            onSelect={addProduct}
            disabled={busy}
          />
        </div>
      </div>

      <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)] lg:h-full lg:overflow-y-auto">
        <CardContent className="space-y-4">
          <div>
            <h2 className="font-heading text-xl font-semibold text-foreground">
              Avoir fournisseur
            </h2>
            <p className="text-sm text-muted-foreground">
              Retour fournisseur avec sortie de stock depuis un emplacement COMDIS.
            </p>
          </div>

          {isEditing ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Modification du brouillon {editingCreditNote?.number}
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <InfoCard label="Utilisateur" value={currentUser.nom} secondary={currentUser.email} />
            <InfoCard
              label="Date"
              value={new Date(`${returnDate}T00:00:00`).toLocaleDateString("fr-FR")}
            />
            <InfoCard
              label="Fournisseur"
              value={selectedSupplier?.name ?? "Fournisseur non selectionne"}
              secondary={selectedSupplier ? `${selectedSupplier.code} - ${selectedSupplier.phone ?? "Sans telephone"}` : null}
            />
            <InfoCard
              label="Stock source"
              value={selectedSource?.name ?? "Stock source non selectionne"}
              secondary={selectedSource?.code ?? null}
            />
          </div>

          <div className="space-y-2">
            <Label>Fournisseur concerne</Label>
            <Input
              value={supplierSearch}
              onChange={(event) => setSupplierSearch(event.target.value)}
              placeholder="Rechercher par nom, code, telephone ou ICE..."
              disabled={busy}
            />
            <Select value={supplierId || undefined} onValueChange={(value) => value && setSupplierId(value)}>
              <SelectTrigger className="h-10 w-full">
                <SelectValue placeholder="Selectionner un fournisseur">
                  {(value: string | null) => {
                    const supplier = suppliers.find((item) => item.id === value);
                    return supplier
                      ? `${supplier.code} - ${supplier.name}`
                      : "Selectionner un fournisseur";
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {filteredSuppliers.map((supplier) => (
                  <SelectItem key={supplier.id} value={supplier.id}>
                    {supplier.code} - {supplier.name} - {supplier.phone ?? "Sans telephone"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedSupplier ? (
            <div className="rounded-2xl border border-border bg-muted/20 p-3 text-sm">
              <p className="font-medium text-foreground">{selectedSupplier.name}</p>
              <p className="mt-1 text-muted-foreground">
                {selectedSupplier.code} - {selectedSupplier.city ?? "Ville non renseignee"} -{" "}
                {selectedSupplier.active ? "Actif" : "Inactif"}
              </p>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="supplier-credit-note-date">Date</Label>
              <Input
                id="supplier-credit-note-date"
                type="date"
                value={returnDate}
                onChange={(event) => setReturnDate(event.target.value)}
                disabled={busy}
              />
            </div>

            <div className="space-y-2">
              <Label>Stock source</Label>
              <Select
                value={sourceLocationId}
                onValueChange={(value) => value && setSourceLocationId(value)}
              >
                <SelectTrigger className="h-10 w-full">
                  <SelectValue placeholder="Selectionner le stock source">
                    {(value: string | null) => {
                      const location = activeLocations.find((item) => item.id === value);
                      return location ? location.name : "Selectionner le stock source";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {activeLocations.map((location) => (
                    <SelectItem key={location.id} value={location.id}>
                      {location.name} - {location.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-2xl border border-border">
            <CreditNoteCart
              lines={cartLines}
              disabled={busy}
              onIncrement={incrementQuantity}
              onDecrement={decrementQuantity}
              onQuantityChange={(productId, quantityReturned) =>
                updateLine(productId, { quantityReturned })
              }
              onUnitPriceChange={(productId, unitPrice) => updateLine(productId, { unitPrice })}
              onDiscountChange={(productId, discountPercent) =>
                updateLine(productId, { discountPercent })
              }
              onRemove={removeLine}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Motif du retour</Label>
              <Select value={reason} onValueChange={(value) => value && setReason(value as CreditNoteReason)}>
                <SelectTrigger className="h-10 w-full">
                  <SelectValue placeholder="Selectionner un motif">
                    {(value: CreditNoteReason | null) =>
                      value ? creditNoteReasonLabels[value] : "Selectionner un motif"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {reasonOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {creditNoteReasonLabels[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="supplier-credit-note-comment">
                Commentaire / justification {reason === "autre" ? "(obligatoire)" : ""}
              </Label>
              <Textarea
                id="supplier-credit-note-comment"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Justification du retour fournisseur..."
                disabled={busy}
              />
            </div>
          </div>

          <CreditNoteSummary
            totalHT={totals.totalHT}
            discountAmount={totals.discountAmount}
            taxAmount={totals.taxAmount}
            totalTTC={totals.totalTTC}
            typeLabel="Avoir fournisseur"
          />

          <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                onClearEditing();
                resetForm();
              }}
            >
              Vider
            </Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => submit("draft")}>
              Enregistrer comme brouillon
            </Button>
            <Button type="button" disabled={busy} onClick={() => submit("validate")}>
              Valider l&apos;avoir fournisseur
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function InfoCard({
  label,
  value,
  secondary,
}: {
  label: string;
  value: string;
  secondary?: string | null;
}) {
  return (
    <div className="rounded-2xl border border-border bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium text-foreground">{value}</p>
      {secondary ? <p className="mt-1 text-xs text-muted-foreground">{secondary}</p> : null}
    </div>
  );
}

function todayDateInput() {
  return new Date().toISOString().slice(0, 10);
}

function toDateInputValue(value: string) {
  return new Date(value).toISOString().slice(0, 10);
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}


function createFormState(editingCreditNote: CreditNote | null | undefined, defaultSourceId: string) {
  if (!editingCreditNote) {
    return {
      search: "",
      supplierSearch: "",
      supplierId: "",
      returnDate: todayDateInput(),
      sourceLocationId: defaultSourceId,
      reason: "produit_defectueux" as CreditNoteReason,
      comment: "",
      cart: [] as CartLine[],
    };
  }

  return {
    search: "",
    supplierSearch: editingCreditNote.supplierName ?? "",
    supplierId: editingCreditNote.supplierId ?? "",
    returnDate: toDateInputValue(editingCreditNote.returnDate),
    sourceLocationId: editingCreditNote.stockSourceLocationId ?? defaultSourceId,
    reason: editingCreditNote.reason,
    comment: editingCreditNote.comment,
    cart: editingCreditNote.lines.map((line) => ({
      productId: line.productId,
      // Phase 3 CRITICAL #1 fix: embedded directly from the draft's own
      // saved line - see CartLine's doc comment.
      productName: line.productName ?? "",
      productReference: line.productReference ?? "",
      productUnit: line.productUnit ?? "",
      quantityReturned: line.quantityReturned,
      unitPrice: line.unitPrice,
      discountPercent: line.discountPercent,
      taxRate: line.taxRate,
    })),
  };
}
