"use client";

import * as React from "react";
import { toast } from "sonner";

import { CommerceProductGrid } from "@/components/commerce/product-grid";
import { CommerceProductSearch } from "@/components/commerce/product-search";
import { useProductPickerSearch } from "@/components/commerce/use-product-picker-search";
import { CreditNoteCart } from "@/components/credit-notes/credit-note-cart";
import { CreditNoteSummary } from "@/components/credit-notes/credit-note-summary";
import { Badge } from "@/components/ui/badge";
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
import { computeLinkedReturnTotals } from "@/lib/pos-discount";
import type { CurrentUser } from "@/types/auth";
import type {
  CreditNote,
  CreditNoteReason,
  CreateCreditNoteInput,
  ReturnableProduct,
} from "@/types/credit-note";
import type { CustomerDto, StockLocationDto } from "@/types/operations-dto";
import type { ProductDto } from "@/types/product-dto";

// A retour-lie ("LINKED") cart line always carries saleLineId plus the
// original SaleLine's own quantity/totalTTC (needed to preview - and let
// the server compute - the EXACT return amount, never a discountPercent-
// based approximation - see computeLinkedReturnTotals). A manual line
// leaves all of these null and behaves exactly like before this rework.
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
  saleLineId: string | null;
  invoiceNumber: string | null;
  originalQuantity: number | null;
  originalTotalTTC: number | null;
  maxQuantityReturnable: number | null;
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

// F4 finalization comment: MANUAL is restricted server-side to
// admin/depot_manager (see persistManualCreditNote). Mirrored here so a
// cashier/driver session never sees a toggle that would just 403.
function canCreateManualReturn(role: CurrentUser["role"]) {
  return role === "admin" || role === "depot_manager";
}

function lineKey(line: CartLine) {
  return line.saleLineId ?? line.productId;
}

type InvoiceGroup = {
  saleId: string;
  invoiceNumber: string;
  saleDate: string;
  lines: {
    productId: string;
    productName: string;
    productReference: string;
    productUnit: string;
    saleLineId: string;
    quantityBought: number;
    quantityAlreadyReturned: number;
    quantityReturnable: number;
    unitPrice: number;
    discountPercent: number;
    taxRate: number;
    originalTotalTTC: number;
  }[];
};

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

  const [mode, setMode] = React.useState<"linked" | "manual">(initialFormState.mode);
  const [search, setSearch] = React.useState(initialFormState.search);
  const [customerSearch, setCustomerSearch] = React.useState(initialFormState.customerSearch);
  const [customerId, setCustomerId] = React.useState(initialFormState.customerId);
  const [returnDate, setReturnDate] = React.useState(initialFormState.returnDate);
  const [destinationId, setDestinationId] = React.useState(initialFormState.destinationId);
  const [reason, setReason] = React.useState<CreditNoteReason>(initialFormState.reason);
  const [comment, setComment] = React.useState(initialFormState.comment);
  const [cart, setCart] = React.useState<CartLine[]>(initialFormState.cart);
  const [busy, setBusy] = React.useState(false);

  const [returnables, setReturnables] = React.useState<ReturnableProduct[]>([]);
  const [loadingReturnables, setLoadingReturnables] = React.useState(false);
  const [selectedSaleId, setSelectedSaleId] = React.useState<string | null>(null);

  const selectedCustomer = customers.find((customer) => customer.id === customerId) ?? null;
  const selectedDestination =
    activeLocations.find((location) => location.id === destinationId) ?? null;
  const allowManual = canCreateManualReturn(currentUser.role);

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
  const productUnitById = React.useMemo(
    () => new Map(products.map((product) => [product.id, product.unit])),
    [products],
  );

  // Client -> factures du client -> produits retournables de cette facture
  // (F4 finalization gap fix): GET /api/credit-notes/returnables already
  // returns, per returnable product, every origin SaleLine it can still be
  // returned against (saleId/saleLineId/invoiceNumber/quantityReturnable) -
  // regrouped here by saleId so the UI can offer "choisir une facture"
  // first, exactly as requested, instead of one flat cross-invoice list.
  React.useEffect(() => {
    // No setState here for the "no customer" case: the render below
    // already shows a dedicated hint whenever customerId is empty,
    // regardless of whatever `returnables` still holds from a previous
    // selection, so there is nothing to synchronize with yet.
    if (!customerId) return;
    let cancelled = false;
    // Same "nothing synchronous in the effect body" shape as
    // customer-combobox.tsx's own search effect - every setState here
    // happens inside a callback (the timer's, or fetch's .then/.catch/
    // .finally), never directly in the effect body itself.
    const timer = setTimeout(() => {
      setLoadingReturnables(true);
      fetch(`/api/credit-notes/returnables?customerId=${encodeURIComponent(customerId)}`, {
        cache: "no-store",
      })
        .then((response) => response.json())
        .then((body: { products?: ReturnableProduct[]; message?: string }) => {
          if (cancelled) return;
          if (!body.products) {
            toast.error(body.message ?? "Impossible de charger les factures du client.");
            setReturnables([]);
            return;
          }
          setReturnables(body.products);
        })
        .catch(() => {
          if (!cancelled) toast.error("Impossible de charger les factures du client.");
        })
        .finally(() => {
          if (!cancelled) setLoadingReturnables(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [customerId]);

  const invoiceGroups = React.useMemo<InvoiceGroup[]>(() => {
    const map = new Map<string, InvoiceGroup>();
    for (const product of returnables) {
      for (const origin of product.origins) {
        const entry = map.get(origin.saleId) ?? {
          saleId: origin.saleId,
          invoiceNumber: origin.invoiceNumber,
          saleDate: origin.saleDate,
          lines: [],
        };
        entry.lines.push({
          productId: product.productId,
          productName: product.productName,
          productReference: product.productReference,
          productUnit: productUnitById.get(product.productId) ?? "",
          saleLineId: origin.saleLineId,
          quantityBought: origin.quantityBought,
          quantityAlreadyReturned: origin.quantityAlreadyReturned,
          quantityReturnable: origin.quantityReturnable,
          unitPrice: origin.unitPrice,
          discountPercent: origin.discountPercent,
          taxRate: origin.taxRate,
          originalTotalTTC: origin.originalTotalTTC,
        });
        map.set(origin.saleId, entry);
      }
    }
    return [...map.values()].sort(
      (a, b) => new Date(b.saleDate).getTime() - new Date(a.saleDate).getTime(),
    );
  }, [returnables, productUnitById]);

  const selectedInvoice = invoiceGroups.find((invoice) => invoice.saleId === selectedSaleId) ?? null;

  // No product lookup needed here anymore - every CartLine already carries
  // its own display fields, captured once at addProduct() time or from the
  // draft's own saved line (see CartLine's doc comment).
  const cartLines = React.useMemo(() => {
    return cart.map((line) => {
      if (line.saleLineId && line.originalQuantity != null && line.originalTotalTTC != null) {
        const totals = computeLinkedReturnTotals({
          taxRate: line.taxRate,
          originalQuantity: line.originalQuantity,
          originalTotalTTC: line.originalTotalTTC,
          quantityReturned: line.quantityReturned,
        });
        return {
          ...line,
          totalHT: totals.totalHT,
          discountAmount: roundMoney(line.unitPrice * line.quantityReturned - totals.totalHT),
          taxAmount: totals.taxAmount,
          totalTTC: totals.totalTTC,
        };
      }

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

  // A user-driven customer change resets which invoice was selected here
  // (rather than in the returnables-fetch effect above) so that effect
  // only ever does the one thing an effect should: synchronize with the
  // external API, never trigger a second render on its own.
  function selectCustomer(nextCustomerId: string) {
    setCustomerId(nextCustomerId);
    setSelectedSaleId(null);
  }

  const resetForm = React.useCallback(
    (nextCustomerId = defaultCustomerId, nextDestinationId = defaultDestinationId) => {
      setMode("linked");
      setSearch("");
      setCustomerSearch("");
      setCustomerId(nextCustomerId);
      setReturnDate(todayDateInput());
      setDestinationId(nextDestinationId);
      setReason("erreur_quantite");
      setComment("");
      setCart([]);
      setSelectedSaleId(null);
    },
    [defaultCustomerId, defaultDestinationId],
  );

  // Switching mode changes what a cart line even means (LINKED requires
  // saleLineId on every line, MANUAL forbids it - persistManualCreditNote
  // rejects a mismatch outright) - so the two never mix in one avoir.
  function changeMode(nextMode: "linked" | "manual") {
    if (nextMode === mode) return;
    if (cart.length > 0) {
      setCart([]);
      toast.message("Panier vide : le mode de retour a change.");
    }
    setMode(nextMode);
  }

  function addProduct(product: ProductDto) {
    setCart((current) => {
      const existing = current.find((line) => line.productId === product.id && !line.saleLineId);
      if (existing) {
        return current.map((line) =>
          line.productId === product.id && !line.saleLineId
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
          saleLineId: null,
          invoiceNumber: null,
          originalQuantity: null,
          originalTotalTTC: null,
          maxQuantityReturnable: null,
        },
      ];
    });
  }

  function addLinkedLine(line: InvoiceGroup["lines"][number], invoiceNumber: string) {
    if (line.quantityReturnable <= 0) return;
    setCart((current) => {
      const existing = current.find((item) => item.saleLineId === line.saleLineId);
      if (existing) {
        return current.map((item) =>
          item.saleLineId === line.saleLineId
            ? {
                ...item,
                quantityReturned: Math.min(item.quantityReturned + 1, line.quantityReturnable),
              }
            : item,
        );
      }

      return [
        ...current,
        {
          productId: line.productId,
          productName: line.productName,
          productReference: line.productReference,
          productUnit: line.productUnit,
          quantityReturned: 1,
          unitPrice: line.unitPrice,
          discountPercent: line.discountPercent,
          taxRate: line.taxRate,
          saleLineId: line.saleLineId,
          invoiceNumber,
          originalQuantity: line.quantityBought,
          originalTotalTTC: line.originalTotalTTC,
          maxQuantityReturnable: line.quantityReturnable,
        },
      ];
    });
  }

  function updateLine(key: string, updates: Partial<CartLine>) {
    setCart((current) =>
      current.map((line) => {
        if (lineKey(line) !== key) return line;
        return { ...line, ...updates };
      }),
    );
  }

  function incrementQuantity(key: string) {
    setCart((current) =>
      current.map((line) => {
        if (lineKey(line) !== key) return line;
        const next = line.quantityReturned + 1;
        return {
          ...line,
          quantityReturned:
            line.maxQuantityReturnable != null ? Math.min(next, line.maxQuantityReturnable) : next,
        };
      }),
    );
  }

  function decrementQuantity(key: string) {
    setCart((current) => {
      const line = current.find((item) => lineKey(item) === key);
      if (!line) return current;
      if (line.quantityReturned <= 1) {
        return current.filter((item) => lineKey(item) !== key);
      }
      return current.map((item) =>
        lineKey(item) === key ? { ...item, quantityReturned: item.quantityReturned - 1 } : item,
      );
    });
  }

  function removeLine(key: string) {
    setCart((current) => current.filter((line) => lineKey(line) !== key));
  }

  async function submit(saveMode: "draft" | "validate") {
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
    if (mode === "linked" && cart.some((line) => !line.saleLineId)) {
      toast.error("Retour lie : chaque ligne doit provenir d'une facture selectionnee.");
      return;
    }

    const payload: CreateCreditNoteInput = {
      id: editingCreditNote?.id,
      partyType: "client",
      customerId: selectedCustomer.id,
      // F4 finalization gap fix: previously never sent at all, which made
      // every submission from this view fail with 422 "Le mode de retour
      // ... est obligatoire" - see the "FINALISATION POS" report. Reflects
      // the real toggle above rather than a constant, since both modes are
      // genuinely reachable here now.
      returnMode: mode === "linked" ? "LINKED" : "MANUAL",
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
        saleLineId: line.saleLineId,
      })),
    };

    setBusy(true);
    try {
      const response = await fetch(
        saveMode === "draft" ? "/api/credit-notes/draft" : "/api/credit-notes/manual",
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
        saveMode === "draft" ? "Avoir enregistre comme brouillon." : "Avoir valide avec succes.",
      );
    } finally {
      setBusy(false);
    }
  }

  const isEditing = Boolean(editingCreditNote);

  return (
    <div className="grid gap-4 lg:h-[calc(100vh-11rem)] lg:grid-cols-2 lg:gap-6">
      <div className="flex flex-col gap-4 lg:h-full lg:overflow-hidden">
        <div className="flex gap-2 rounded-xl border border-border bg-muted/30 p-1">
          <button
            type="button"
            onClick={() => changeMode("linked")}
            disabled={busy}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              mode === "linked"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Lie a une facture
          </button>
          <button
            type="button"
            onClick={() => allowManual && changeMode("manual")}
            disabled={busy || !allowManual}
            title={allowManual ? undefined : "Reserve aux administrateurs / responsables de depot"}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              mode === "manual"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Retour manuel
          </button>
        </div>

        {mode === "manual" ? (
          <>
            <CommerceProductSearch value={search} onChange={setSearch} />
            <div className="lg:flex-1 lg:overflow-y-auto lg:pr-1">
              <CommerceProductGrid products={filteredProducts} onSelect={addProduct} disabled={busy} />
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-3 lg:flex-1 lg:overflow-y-auto lg:pr-1">
            {!customerId ? (
              <EmptyHint message="Selectionnez d'abord un client pour voir ses factures." />
            ) : loadingReturnables ? (
              <EmptyHint message="Chargement des factures du client..." />
            ) : invoiceGroups.length === 0 ? (
              <EmptyHint message="Aucune facture avec un produit encore retournable pour ce client." />
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  <Label>Facture</Label>
                  {invoiceGroups.map((invoice) => (
                    <button
                      key={invoice.saleId}
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setSelectedSaleId((current) =>
                          current === invoice.saleId ? null : invoice.saleId,
                        )
                      }
                      className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
                        selectedSaleId === invoice.saleId
                          ? "border-emerald-500 bg-emerald-50"
                          : "border-border hover:border-emerald-300"
                      }`}
                    >
                      <span className="font-medium text-foreground">
                        Facture {invoice.invoiceNumber}
                      </span>
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        {new Date(invoice.saleDate).toLocaleDateString("fr-FR")}
                        <Badge variant="secondary">{invoice.lines.length} produit(s)</Badge>
                      </span>
                    </button>
                  ))}
                </div>

                {selectedInvoice ? (
                  <div className="rounded-2xl border border-border">
                    {selectedInvoice.lines.map((line) => {
                      const cartQty =
                        cart.find((item) => item.saleLineId === line.saleLineId)?.quantityReturned ??
                        0;
                      return (
                        <div
                          key={line.saleLineId}
                          className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-sm last:border-b-0"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium text-foreground">{line.productName}</p>
                            <p className="text-xs text-muted-foreground">
                              Achete {line.quantityBought} - deja retourne {line.quantityAlreadyReturned}{" "}
                              - retournable {line.quantityReturnable}
                            </p>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant={cartQty > 0 ? "secondary" : "outline"}
                            disabled={busy || line.quantityReturnable <= 0}
                            onClick={() => addLinkedLine(line, selectedInvoice.invoiceNumber)}
                          >
                            {cartQty > 0 ? `Ajoute (${cartQty})` : "Ajouter"}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </>
            )}
          </div>
        )}
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
            <Select value={customerId} onValueChange={(value) => value && selectCustomer(value)}>
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
              lines={cartLines.map((line) => ({
                ...line,
                productId: lineKey(line),
                invoiceNumber: line.invoiceNumber,
                readOnlyPricing: Boolean(line.saleLineId),
                maxQuantity: line.maxQuantityReturnable ?? undefined,
              }))}
              disabled={busy}
              onIncrement={incrementQuantity}
              onDecrement={decrementQuantity}
              onQuantityChange={(key, quantityReturned) => {
                const line = cart.find((item) => lineKey(item) === key);
                const capped =
                  line?.maxQuantityReturnable != null
                    ? Math.min(Math.max(1, quantityReturned), line.maxQuantityReturnable)
                    : Math.max(1, quantityReturned);
                updateLine(key, { quantityReturned: capped });
              }}
              onUnitPriceChange={(key, unitPrice) => updateLine(key, { unitPrice })}
              onDiscountChange={(key, discountPercent) => updateLine(key, { discountPercent })}
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

function EmptyHint({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-10 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
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
    .replace(/[̀-ͯ]/g, "")
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
      mode: "linked" as const,
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

  const cart: CartLine[] = editingCreditNote.lines.map((line) => ({
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
    saleLineId: line.saleLineId ?? null,
    invoiceNumber: line.invoiceNumber ?? null,
    // A reopened draft's exact preview is a minor nicety, not a
    // correctness requirement (the server recomputes the real total from
    // saleLineId regardless of what this shows) - not worth a dedicated
    // endpoint just to refetch originalQuantity/originalTotalTTC here.
    originalQuantity: null,
    originalTotalTTC: null,
    maxQuantityReturnable: null,
  }));

  return {
    // Inferred from the saved lines themselves (CreditNote has no
    // standalone returnMode field) - every line of a given avoir always
    // shares one mode, enforced server-side at creation.
    mode: (cart.some((line) => line.saleLineId) ? "linked" : "manual") as "linked" | "manual",
    search: "",
    customerSearch: editingCreditNote.customerName ?? "",
    customerId: editingCreditNote.customerId,
    returnDate: toDateInputValue(editingCreditNote.returnDate),
    destinationId: editingCreditNote.stockDestinationLocationId,
    reason: editingCreditNote.reason,
    comment: editingCreditNote.comment,
    cart,
  };
}
