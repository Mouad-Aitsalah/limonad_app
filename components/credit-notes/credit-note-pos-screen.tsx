"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";

import { useProductPickerSearch } from "@/components/commerce/use-product-picker-search";
import { RefundDialog } from "@/components/credit-notes/refund-dialog";
import { CartSummary } from "@/components/pos/cart-summary";
import { CartTable } from "@/components/pos/cart-table";
import { CustomerCombobox } from "@/components/pos/customer-combobox";
import { PosCatalogScroller, PosProductGrid } from "@/components/pos/pos-catalog-display";
import { ProductSearch } from "@/components/pos/product-search";
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
import {
  buildCreditNotePosPayload,
  creditLineToCartLine,
  creditNoteBlockingReason,
  creditTotals,
  creditTotalsToCartTotals,
  defaultReasonFor,
  productToCreditLine,
  productToPosProduct,
  type CreditPosLine,
} from "@/lib/credit-note-pos";
import { formatCurrency } from "@/lib/utils";
import type { CreditNote, CreditNotePartyType, CreditNoteReason } from "@/types/credit-note";
import type { CustomerDto, StockLocationDto, SupplierPartnerDto } from "@/types/operations-dto";
import type { ProductDto } from "@/types/product-dto";

type CreditNotePosScreenProps = {
  party: CreditNotePartyType;
  customers: CustomerDto[];
  suppliers: SupplierPartnerDto[];
  /** Small bounded preload (getProductPickerPreload); anything else comes from /api/products/search. */
  products: ProductDto[];
  locations: StockLocationDto[];
};

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function todayDateInput() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * « Avoir client » / « Avoir fournisseur »: the POS interface (search + product grid on the left, cart and
 * total on the right) used to build an avoir. It is NOT a sale: no invoice header, no invoice
 * navigation, and « Encaisser » records a REFUND (payment mode « Rembourser ») through the credit note
 * service - for a customer, cash going out of the till exactly once (see lib/server/credit-notes.ts).
 */
export function CreditNotePosScreen({
  party,
  customers,
  suppliers,
  products,
  locations,
}: CreditNotePosScreenProps) {
  const isClient = party === "client";

  // A return goes back to / leaves from a DEPOT only - a truck is never offered (the server refuses it).
  const depots = React.useMemo(
    () =>
      [...locations]
        .filter((location) => location.active && location.type === "DEPOT")
        .sort((a, b) => a.name.localeCompare(b.name, "fr-FR")),
    [locations],
  );
  const defaultDepotId = React.useMemo(
    () =>
      depots.find((depot) => normalizeSearch(`${depot.name} ${depot.code}`).includes("principal"))?.id ??
      depots[0]?.id ??
      "",
    [depots],
  );
  const defaultCustomer = React.useMemo(
    () =>
      customers.find((customer) => customer.type === "COUNTER" && customer.status === "ACTIVE") ??
      customers.find((customer) => customer.status === "ACTIVE") ??
      null,
    [customers],
  );

  const [search, setSearch] = React.useState("");
  const [customer, setCustomer] = React.useState<CustomerDto | null>(defaultCustomer);
  const [supplierId, setSupplierId] = React.useState("");
  const [supplierSearch, setSupplierSearch] = React.useState("");
  const [cart, setCart] = React.useState<CreditPosLine[]>([]);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [depotId, setDepotId] = React.useState(defaultDepotId);
  const [reason, setReason] = React.useState<CreditNoteReason>(defaultReasonFor(party));
  const [comment, setComment] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [lastSaved, setLastSaved] = React.useState<{ id: string; number: string; amount: number } | null>(null);
  // One key per avoir being created: a double click or a retry of the same submission returns the avoir
  // already created (server-side idempotency). Renewed only once the avoir is saved.
  const idempotencyKeyRef = React.useRef<string>(crypto.randomUUID());
  // Synchronous guard: a second click in the same tick must not start a second request.
  const submittingRef = React.useRef(false);

  const selectedSupplier = suppliers.find((supplier) => supplier.id === supplierId) ?? null;
  const partyId = isClient ? (customer?.id ?? "") : (selectedSupplier?.id ?? "");
  const partyName = isClient ? (customer?.name ?? "") : (selectedSupplier?.name ?? "");

  // Supplier notes: the catalogue starts from that supplier's products (same fallback as before the rework).
  const [supplierPreload, setSupplierPreload] = React.useState<{ supplierId: string; products: ProductDto[] } | null>(
    null,
  );
  React.useEffect(() => {
    if (isClient || !selectedSupplier) return;
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
  }, [isClient, selectedSupplier]);
  const catalogue =
    !isClient && selectedSupplier && supplierPreload?.supplierId === selectedSupplier.id
      ? supplierPreload.products
      : products;

  const { results, allKnownProducts } = useProductPickerSearch(catalogue, search, {
    supplierId: isClient ? undefined : selectedSupplier?.id,
  });
  const posProducts = React.useMemo(
    () => results.map((product) => productToPosProduct(product, party)),
    [results, party],
  );
  const knownById = React.useMemo(
    () => new Map(allKnownProducts.map((product) => [product.id, product])),
    [allKnownProducts],
  );

  const totals = React.useMemo(() => creditTotals(cart), [cart]);
  const cartLines = React.useMemo(() => cart.map(creditLineToCartLine), [cart]);
  const cartTotals = React.useMemo(() => creditTotalsToCartTotals(totals), [totals]);

  const filteredSuppliers = React.useMemo(() => {
    const query = normalizeSearch(supplierSearch);
    if (!query) return suppliers.slice(0, 25);
    return suppliers
      .filter((supplier) =>
        normalizeSearch(`${supplier.name} ${supplier.code} ${supplier.phone ?? ""} ${supplier.ice ?? ""}`).includes(
          query,
        ),
      )
      .slice(0, 25);
  }, [supplierSearch, suppliers]);

  function addProduct(productId: string) {
    const product = knownById.get(productId);
    if (!product) return false;
    setCart((current) => {
      const existing = current.find((line) => line.productId === productId);
      if (existing) {
        return current.map((line) =>
          line.productId === productId ? { ...line, quantityReturned: line.quantityReturned + 1 } : line,
        );
      }
      return [...current, productToCreditLine(product, party)];
    });
    return true;
  }

  function increment(productId: string) {
    setCart((current) =>
      current.map((line) =>
        line.productId === productId ? { ...line, quantityReturned: line.quantityReturned + 1 } : line,
      ),
    );
  }

  function setQuantity(productId: string, quantity: number) {
    setCart((current) =>
      current.map((line) =>
        line.productId === productId
          ? { ...line, quantityReturned: Math.max(1, Math.trunc(quantity) || 1) }
          : line,
      ),
    );
  }

  function decrement(productId: string) {
    setCart((current) => {
      const line = current.find((item) => item.productId === productId);
      if (!line) return current;
      if (line.quantityReturned <= 1) return current.filter((item) => item.productId !== productId);
      return current.map((item) =>
        item.productId === productId ? { ...item, quantityReturned: item.quantityReturned - 1 } : item,
      );
    });
  }

  function resetForm() {
    setSearch("");
    setCart([]);
    setComment("");
    setReason(defaultReasonFor(party));
    setCustomer(defaultCustomer);
    setSupplierId("");
    setSupplierSearch("");
    // A new avoir starts: it gets its own submission key.
    idempotencyKeyRef.current = crypto.randomUUID();
  }

  const blockingReason = creditNoteBlockingReason({
    party,
    partyId,
    depotId,
    reason,
    comment,
    lineCount: cart.length,
  });

  async function confirmRefund() {
    if (submittingRef.current || blockingReason) return;
    submittingRef.current = true;
    setBusy(true);
    try {
      const payload = buildCreditNotePosPayload({
        party,
        partyId,
        depotId,
        reason,
        comment: comment.trim(),
        returnDate: todayDateInput(),
        idempotencyKey: idempotencyKeyRef.current,
        lines: cart,
      });
      const response = await fetch("/api/credit-notes/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as { creditNote?: CreditNote; message?: string };
      if (!response.ok || !body.creditNote) {
        toast.error(body.message ?? "Impossible d'enregistrer l'avoir.");
        return;
      }
      const saved = body.creditNote;
      setLastSaved({ id: saved.id, number: saved.number, amount: saved.totalTTC ?? totals.totalTTC });
      setDialogOpen(false);
      resetForm();
      toast.success(
        isClient
          ? `Avoir ${saved.number} enregistré : ${formatCurrency(saved.totalTTC ?? totals.totalTTC)} remboursés.`
          : `Avoir fournisseur ${saved.number} enregistré.`,
      );
    } catch {
      toast.error("Impossible d'enregistrer l'avoir. Vérifiez la connexion et réessayez.");
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:h-[calc(100vh-11rem)] lg:grid-cols-2 lg:gap-6" data-testid="credit-note-pos">
      <div className="flex flex-col gap-4 lg:h-full lg:overflow-hidden">
        <ProductSearch value={search} onChange={setSearch} />
        <PosCatalogScroller className="lg:flex-1 lg:overflow-y-auto lg:pr-1">
          <PosProductGrid products={posProducts} onAdd={addProduct} showStock={false} />
        </PosCatalogScroller>
      </div>

      <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)] lg:h-full lg:overflow-y-auto">
        <CardContent className="space-y-4">
          <div>
            <h2 className="font-heading text-xl font-semibold text-foreground">
              {isClient ? "Avoir client" : "Avoir fournisseur"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {isClient
                ? "Retour de marchandises remboursé au client."
                : "Retour de marchandises au fournisseur."}
            </p>
          </div>

          {lastSaved ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              Avoir{" "}
              <Link href={`/avoirs/${lastSaved.id}`} className="font-semibold underline">
                {lastSaved.number}
              </Link>{" "}
              enregistré
              {isClient ? ` - ${formatCurrency(lastSaved.amount)} remboursés.` : "."}
            </div>
          ) : null}

          {isClient ? (
            <CustomerCombobox
              value={customer}
              onChange={setCustomer}
              initialSuggestions={customers.slice(0, 25)}
            />
          ) : (
            <div className="space-y-2">
              <Label>Fournisseur</Label>
              <Input
                value={supplierSearch}
                onChange={(event) => setSupplierSearch(event.target.value)}
                placeholder="Rechercher par nom, code ou téléphone..."
                disabled={busy}
              />
              <Select value={supplierId} onValueChange={(value) => value && setSupplierId(value)}>
                <SelectTrigger className="h-10 w-full">
                  <SelectValue placeholder="Sélectionner un fournisseur">
                    {(value: string | null) => {
                      const supplier = suppliers.find((item) => item.id === value);
                      return supplier ? `${supplier.code} - ${supplier.name}` : "Sélectionner un fournisseur";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {filteredSuppliers.map((supplier) => (
                    <SelectItem key={supplier.id} value={supplier.id}>
                      {supplier.code} - {supplier.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="rounded-2xl border border-border">
            <CartTable
              lines={cartLines}
              operationType="sale"
              pcLayout
              hideDiscount
              readOnly={busy}
              onIncrement={increment}
              onDecrement={decrement}
              onQuantityChange={setQuantity}
              onDiscountChange={() => undefined}
              onRemove={(productId) =>
                setCart((current) => current.filter((line) => line.productId !== productId))
              }
            />
          </div>

          <CartSummary totals={cartTotals} operationType="sale" totalLabel="Total à rembourser" />

          <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" disabled={busy || cart.length === 0} onClick={resetForm}>
              Vider
            </Button>
            <Button
              type="button"
              disabled={busy || cart.length === 0}
              onClick={() => setDialogOpen(true)}
              className="sm:min-w-40"
            >
              Encaisser
            </Button>
          </div>
        </CardContent>
      </Card>

      <RefundDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        party={party}
        partyName={partyName || (isClient ? "Client" : "Fournisseur")}
        totalTTC={totals.totalTTC}
        depots={depots}
        depotId={depotId}
        onDepotChange={setDepotId}
        reason={reason}
        onReasonChange={setReason}
        comment={comment}
        onCommentChange={setComment}
        busy={busy}
        blockingReason={blockingReason}
        onConfirm={() => void confirmRefund()}
      />
    </div>
  );
}
