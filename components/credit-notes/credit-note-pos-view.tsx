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
import type { CreditNote, CreditNoteReason, CreateCreditNoteInput } from "@/types/credit-note";
import type { CustomerDto, StockLocationDto } from "@/types/operations-dto";
import type { ProductDto } from "@/types/product-dto";

type CartLine = {
  productId: string;
  // Phase 3 CRITICAL #1 fix: captured once, from the full ProductDto
  // available at the moment a product is picked (addProduct) or from the
  // draft's own already-saved line (editing mode) - cartLines below no
  // longer needs to re-resolve these against `products`, which is now a
  // small bounded preload/search result set, not the full catalog.
  productName: string;
  productReference: string;
  productUnit: string;
  quantityReturned: number;
  unitPrice: number;
  discountPercent: number;
  taxRate: number;
};

type CreditNotePosViewProps = {
  customers: CustomerDto[];
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
  "erreur_livraison",
  "erreur_quantite",
  "produit_non_conforme",
  "echange_client",
  "retour_commercial",
  "autre",
];

export function CreditNotePosView({
  customers,
  products,
  locations,
  currentUser,
  editingCreditNote,
  onSaved,
  onClearEditing,
}: CreditNotePosViewProps) {
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

  const defaultCustomerId = React.useMemo(
    () =>
      customers.find((customer) => customer.type === "COUNTER" && customer.status === "ACTIVE")
        ?.id ??
      customers.find((customer) => customer.status === "ACTIVE")?.id ??
      "",
    [customers],
  );

  const defaultDestinationId = React.useMemo(
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

  const initialFormState = createFormState(
    editingCreditNote,
    defaultCustomerId,
    defaultDestinationId,
  );

  const [search, setSearch] = React.useState(initialFormState.search);
  const [customerSearch, setCustomerSearch] = React.useState(initialFormState.customerSearch);
  const [customerId, setCustomerId] = React.useState(initialFormState.customerId);
  const [returnDate, setReturnDate] = React.useState(initialFormState.returnDate);
  const [destinationId, setDestinationId] = React.useState(initialFormState.destinationId);
  const [reason, setReason] = React.useState<CreditNoteReason>(initialFormState.reason);
  const [comment, setComment] = React.useState(initialFormState.comment);
  const [cart, setCart] = React.useState<CartLine[]>(initialFormState.cart);
  const [busy, setBusy] = React.useState(false);

  const selectedCustomer = customers.find((customer) => customer.id === customerId) ?? null;
  const selectedDestination =
    activeLocations.find((location) => location.id === destinationId) ?? null;

  const filteredCustomers = React.useMemo(() => {
    const query = normalizeSearch(customerSearch);
    if (!query) return customers.slice(0, 25);
    return customers
      .filter((customer) =>
        normalizeSearch(`${customer.name} ${customer.code} ${customer.phone}`).includes(query),
      )
      .slice(0, 25);
  }, [customerSearch, customers]);

  // Phase 3 CRITICAL #1 fix: `products` is now a small bounded preload
  // (getProductPickerPreload, already ACTIVE-only) - anything beyond it
  // comes from GET /api/products/search instead. See
  // use-product-picker-search.ts's doc comment.
  const { results: filteredProducts } = useProductPickerSearch(products, search);

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

  const resetForm = React.useCallback(
    (nextCustomerId = defaultCustomerId, nextDestinationId = defaultDestinationId) => {
      setSearch("");
      setCustomerSearch("");
      setCustomerId(nextCustomerId);
      setReturnDate(todayDateInput());
      setDestinationId(nextDestinationId);
      setReason("erreur_quantite");
      setComment("");
      setCart([]);
    },
    [defaultCustomerId, defaultDestinationId],
  );

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
          unitPrice: product.salePrice,
          discountPercent: 0,
          taxRate: product.taxRate,
        },
      ];
    });
  }

  function updateLine(productId: string, updates: Partial<CartLine>) {
    setCart((current) =>
      current.map((line) => {
        if (line.productId !== productId) return line;
        return { ...line, ...updates };
      }),
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
    if (!selectedCustomer) {
      toast.error("Selectionnez un client.");
      return;
    }
    if (!selectedDestination) {
      toast.error("Selectionnez la destination du stock.");
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
      partyType: "client",
      customerId: selectedCustomer.id,
      reason,
      comment,
      returnDate,
      stockDestinationLocationId: selectedDestination.id,
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
        toast.error(body.message ?? "Impossible d'enregistrer l'avoir.");
        return;
      }

      onSaved(body.creditNote);
      onClearEditing();
      resetForm();
      toast.success(
        mode === "draft" ? "Avoir enregistre comme brouillon." : "Avoir valide avec succes.",
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
            <h2 className="font-heading text-xl font-semibold text-foreground">Avoir</h2>
            <p className="text-sm text-muted-foreground">
              Retour de marchandises et reintegration en stock.
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
              label="Client"
              value={selectedCustomer?.name ?? "Client non selectionne"}
              secondary={selectedCustomer ? `${selectedCustomer.code} - ${selectedCustomer.phone}` : null}
            />
            <InfoCard
              label="Destination du stock"
              value={selectedDestination?.name ?? "Destination non selectionnee"}
              secondary={selectedDestination?.code ?? null}
            />
          </div>

          <div className="space-y-2">
            <Label>Client</Label>
            <Input
              value={customerSearch}
              onChange={(event) => setCustomerSearch(event.target.value)}
              placeholder="Rechercher par nom, code ou telephone..."
              disabled={busy}
            />
            <Select value={customerId} onValueChange={(value) => value && setCustomerId(value)}>
              <SelectTrigger className="h-10 w-full">
                <SelectValue placeholder="Selectionner un client">
                  {(value: string | null) => {
                    const customer = customers.find((item) => item.id === value);
                    return customer ? `${customer.code} - ${customer.name}` : "Selectionner un client";
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {filteredCustomers.map((customer) => (
                  <SelectItem key={customer.id} value={customer.id}>
                    {customer.code} - {customer.name} - {customer.phone}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="credit-note-date">Date</Label>
              <Input
                id="credit-note-date"
                type="date"
                value={returnDate}
                onChange={(event) => setReturnDate(event.target.value)}
                disabled={busy}
              />
            </div>

            <div className="space-y-2">
              <Label>Destination du stock</Label>
              <Select
                value={destinationId}
                onValueChange={(value) => value && setDestinationId(value)}
              >
                <SelectTrigger className="h-10 w-full">
                  <SelectValue placeholder="Selectionner une destination">
                    {(value: string | null) => {
                      const location = activeLocations.find((item) => item.id === value);
                      return location ? location.name : "Selectionner une destination";
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
              <Label htmlFor="credit-note-comment">
                Commentaire / justification {reason === "autre" ? "(obligatoire)" : ""}
              </Label>
              <Textarea
                id="credit-note-comment"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Motif detaille du retour..."
                disabled={busy}
              />
            </div>
          </div>

          <CreditNoteSummary
            totalHT={totals.totalHT}
            discountAmount={totals.discountAmount}
            taxAmount={totals.taxAmount}
            totalTTC={totals.totalTTC}
            typeLabel="Avoir client"
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
              Valider l&apos;avoir
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


function createFormState(
  editingCreditNote: CreditNote | null | undefined,
  defaultCustomerId: string,
  defaultDestinationId: string,
) {
  if (!editingCreditNote) {
    return {
      search: "",
      customerSearch: "",
      customerId: defaultCustomerId,
      returnDate: todayDateInput(),
      destinationId: defaultDestinationId,
      reason: "erreur_quantite" as CreditNoteReason,
      comment: "",
      cart: [] as CartLine[],
    };
  }

  return {
    search: "",
    customerSearch: editingCreditNote.customerName ?? "",
    customerId: editingCreditNote.customerId,
    returnDate: toDateInputValue(editingCreditNote.returnDate),
    destinationId: editingCreditNote.stockDestinationLocationId,
    reason: editingCreditNote.reason,
    comment: editingCreditNote.comment,
    cart: editingCreditNote.lines.map((line) => ({
      productId: line.productId,
      // Phase 3 CRITICAL #1 fix: embedded directly from the draft's own
      // saved line (see CreditNoteLine's doc comment) - no longer depends
      // on `products` (now a small preload/search result set) still
      // containing this exact product.
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
