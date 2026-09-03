"use client";

import * as React from "react";
import { toast } from "sonner";

import { roundCurrency } from "@/lib/utils";
import type { CounterPosContextDto, CustomerDto, SaleDto } from "@/types/operations-dto";
import {
  defaultPaymentMethod,
  posPaymentMethods,
  type PosOperationType,
  type PosPaymentMethodValue,
  type PosProduct,
} from "@/types/pos";
import { ProductSearch } from "@/components/pos/product-search";
import { ProductGrid } from "@/components/pos/product-grid";
import { usePosProductSearch } from "@/components/pos/use-pos-product-search";
import { InvoiceHeader } from "@/components/pos/invoice-header";
import { CustomerCombobox } from "@/components/pos/customer-combobox";
import { CustomerNumberInput } from "@/components/pos/customer-number-input";
import { PaymentSelector } from "@/components/pos/payment-selector";
import { CartTable } from "@/components/pos/cart-table";
import { CartSummary } from "@/components/pos/cart-summary";
import { InvoiceActions } from "@/components/pos/invoice-actions";
import { CheckoutDialog } from "@/components/pos/checkout-dialog";
import { CollectDialog } from "@/components/pos/collect-dialog";
import { PendingSalesPanel } from "@/components/pos/pending-sales-panel";
import { ReceiptPrint } from "@/components/pos/receipt-print";

export type CartLine = {
  productId: string;
  quantity: number;
  discountPercent: number;
};

export type CartLineComputed = {
  productId: string;
  designation: string;
  reference: string;
  quantity: number;
  discountPercent: number;
  unitPriceHT: number;
  unitPriceTTC: number;
  tauxTVA: number;
  baseHT: number;
  discountAmount: number;
  netHT: number;
  tvaAmount: number;
  totalTTC: number;
  transferValue: number;
};

export type CartTotals = {
  sousTotalHT: number;
  remise: number;
  tva: number;
  totalTTC: number;
  netAPayer: number;
  transferValue: number;
};

type PosLayoutProps = {
  initialContext: CounterPosContextDto;
};

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function resolveDefaultCustomer(customers: CustomerDto[]): CustomerDto | null {
  return customers.find((customer) => customer.type === "COUNTER") ?? customers[0] ?? null;
}

function mapContextProductsToPosProducts(
  products: CounterPosContextDto["products"],
): PosProduct[] {
  return products.map((product) => ({
    id: product.id,
    reference: product.reference,
    barcode: product.barcode,
    designation: product.name,
    prixVenteHT: product.salePriceHT,
    prixVenteTTC: product.salePriceTTC,
    tauxTVA: product.taxRate,
    quantiteStock: product.availableQuantity,
    imageUrl: product.imageUrl,
  }));
}

export function PosLayout({ initialContext }: PosLayoutProps) {
  const [context, setContext] = React.useState(initialContext);
  const [search, setSearch] = React.useState("");
  const [cart, setCart] = React.useState<CartLine[]>([]);
  // Phase 3: the fully-resolved customer object, not just an id - kept as
  // its own state (not derived from context.customers.find(...)) because
  // context.customers is now only a small preload (see
  // getPosCustomerPreload); a customer found via the combobox's search
  // fallback must stay selected/resolvable even though it was never in
  // that preloaded list.
  const [selectedCustomer, setSelectedCustomer] = React.useState<CustomerDto | null>(
    resolveDefaultCustomer(initialContext.customers),
  );
  const [paymentMethod, setPaymentMethod] =
    React.useState<PosPaymentMethodValue>(defaultPaymentMethod);
  const [chequeNumber, setChequeNumber] = React.useState("");
  const [banque, setBanque] = React.useState("");
  const [dateEcheance, setDateEcheance] = React.useState("");
  const [checkoutOpen, setCheckoutOpen] = React.useState(false);
  // Stable for one sale attempt (F5): kept identical across a network retry
  // of confirmOperation, only ever replaced in resetOperation() once a sale
  // has actually gone through and a new one starts. A ref (not state) so it
  // never triggers a re-render and is guaranteed synchronously current the
  // instant confirmOperation reads it.
  const idempotencyKeyRef = React.useRef<string>(crypto.randomUUID());
  const [submitting, setSubmitting] = React.useState(false);
  const [lastSale, setLastSale] = React.useState<SaleDto | null>(null);

  // "Factures du jour" - server-persisted DRAFT sales awaiting collection.
  const [pendingSales, setPendingSales] = React.useState<SaleDto[]>([]);
  const [preparing, setPreparing] = React.useState(false);
  const [collectTarget, setCollectTarget] = React.useState<SaleDto | null>(null);
  const [collectOpen, setCollectOpen] = React.useState(false);
  const [collecting, setCollecting] = React.useState(false);

  const operationType: PosOperationType = "sale";
  // Phase 3: when the depot has more sellable products than the POS context
  // preloads (context.productsTruncated), fall back to a server search
  // scoped to this depot's stock location instead of only ever searching
  // the (possibly incomplete) preloaded list. allKnownProducts accumulates
  // every product ever found this way so a remotely-found item stays
  // resolvable in the cart even after the search term changes.
  const { products: matchedProducts, allKnownProducts } = usePosProductSearch(
    context.products,
    search,
    {
      truncated: context.productsTruncated,
      locationId: context.stockLocation.id,
      normalize: normalizeSearch,
    },
  );
  const sellableProducts = React.useMemo(
    () => mapContextProductsToPosProducts(allKnownProducts),
    [allKnownProducts],
  );
  const productById = React.useMemo(() => {
    return new Map(sellableProducts.map((product) => [product.id, product]));
  }, [sellableProducts]);

  const filteredProducts = React.useMemo(
    () => mapContextProductsToPosProducts(matchedProducts),
    [matchedProducts],
  );

  const cartLines = React.useMemo<CartLineComputed[]>(() => {
    return cart.flatMap((line) => {
      const product = productById.get(line.productId);
      if (!product) return [];

      const unitPriceHT = product.prixVenteHT;
      const unitPriceTTC = product.prixVenteTTC;
      const discountPercent = line.discountPercent;
      const tauxTVA = product.tauxTVA;
      const baseHT = unitPriceHT * line.quantity;
      const discountAmount = baseHT * (discountPercent / 100);
      const netHT = baseHT - discountAmount;
      const tvaAmount = netHT * (tauxTVA / 100);
      const totalTTC = netHT + tvaAmount;

      return {
        productId: line.productId,
        designation: product.designation,
        reference: product.reference,
        quantity: line.quantity,
        discountPercent,
        unitPriceHT,
        unitPriceTTC,
        tauxTVA,
        baseHT,
        discountAmount,
        netHT,
        tvaAmount,
        totalTTC,
        transferValue: 0,
      };
    });
  }, [cart, productById]);

  const totals = React.useMemo<CartTotals>(() => {
    const sousTotalHT = roundCurrency(
      cartLines.reduce((sum, line) => sum + line.baseHT, 0),
    );
    const remise = roundCurrency(
      cartLines.reduce((sum, line) => sum + line.discountAmount, 0),
    );
    const tva = roundCurrency(
      cartLines.reduce((sum, line) => sum + line.tvaAmount, 0),
    );
    const totalTTC = roundCurrency(sousTotalHT - remise + tva);

    return {
      sousTotalHT,
      remise,
      tva,
      totalTTC,
      netAPayer: totalTTC,
      transferValue: 0,
    };
  }, [cartLines]);

  // Negative stock is allowed: the cart quantity is never capped at the
  // product's on-hand stock. The only lower bound is 1.
  function addToCart(productId: string) {
    const product = productById.get(productId);
    if (!product) return;

    setCart((prev) => {
      const existing = prev.find((line) => line.productId === productId);
      if (existing) {
        return prev.map((line) =>
          line.productId === productId
            ? { ...line, quantity: line.quantity + 1 }
            : line,
        );
      }
      return [...prev, { productId, quantity: 1, discountPercent: 0 }];
    });
  }

  function updateQuantity(productId: string, quantity: number) {
    setCart((prev) =>
      prev.map((line) =>
        line.productId === productId
          ? { ...line, quantity: Math.max(1, quantity) }
          : line,
      ),
    );
  }

  function incrementQuantity(productId: string) {
    setCart((prev) =>
      prev.map((line) =>
        line.productId === productId
          ? { ...line, quantity: line.quantity + 1 }
          : line,
      ),
    );
  }

  function decrementQuantity(productId: string) {
    setCart((prev) => {
      const line = prev.find((item) => item.productId === productId);
      if (!line) return prev;

      if (line.quantity <= 1) {
        return prev.filter((item) => item.productId !== productId);
      }
      return prev.map((item) =>
        item.productId === productId
          ? { ...item, quantity: item.quantity - 1 }
          : item,
      );
    });
  }

  function updateDiscount(productId: string, discountPercent: number) {
    setCart((prev) =>
      prev.map((line) =>
        line.productId === productId ? { ...line, discountPercent } : line,
      ),
    );
  }

  function removeFromCart(productId: string) {
    setCart((prev) => prev.filter((line) => line.productId !== productId));
  }

  function resetOperation() {
    setCart([]);
    setPaymentMethod(defaultPaymentMethod);
    setChequeNumber("");
    setBanque("");
    setDateEcheance("");
    // A new sale starts here - mint a fresh key so it never gets confused
    // with the one just used (whether that one succeeded or is still
    // in-flight).
    idempotencyKeyRef.current = crypto.randomUUID();
  }

  async function refreshContext() {
    const refreshed = await fetch("/api/sales/context", { cache: "no-store" });
    const payload = await refreshed.json();
    if (!refreshed.ok) {
      throw new Error(payload.message ?? "Impossible de rafraîchir le stock.");
    }

    const nextContext = payload.context as CounterPosContextDto;
    setContext(nextContext);
    // The selected customer is independent client state now (see
    // selectedCustomer's declaration) - a refresh must never silently drop
    // it just because it isn't in the new context's small preload. Only
    // fall back to the default when nothing was selected at all.
    setSelectedCustomer((current) => current ?? resolveDefaultCustomer(nextContext.customers));
  }

  function buildSaleBody(extra: Record<string, unknown>) {
    return JSON.stringify({
      customerId: selectedCustomer?.id ?? null,
      paymentMethod,
      reference:
        paymentMethod === "CHECK"
          ? chequeNumber || null
          : paymentMethod === "BANK_TRANSFER"
            ? banque || null
            : null,
      lines: cartLines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        discountRate: line.discountPercent,
      })),
      idempotencyKey: idempotencyKeyRef.current,
      ...extra,
    });
  }

  async function refreshPending() {
    try {
      const response = await fetch("/api/sales/pending", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { sales?: SaleDto[] };
      setPendingSales(payload.sales ?? []);
    } catch {
      // non-fatal: the panel just stays as it was
    }
  }

  React.useEffect(() => {
    let active = true;
    fetch("/api/sales/pending", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { sales: [] }))
      .then((payload: { sales?: SaleDto[] }) => {
        if (active) setPendingSales(payload.sales ?? []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  async function confirmOperation(paidAmount?: number) {
    if (!selectedCustomer) {
      toast.error("Sélectionnez un client avant de valider.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: buildSaleBody({ paidAmount }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message ?? "Impossible d'enregistrer la vente.");
      }

      setLastSale(payload.sale as SaleDto);
      toast.success(`Vente ${payload.sale.invoiceNumber} enregistrée.`);
      setCheckoutOpen(false);
      resetOperation();
      await refreshContext();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Impossible d'enregistrer la vente.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  // "Préparer la facture" - persist a DRAFT "Facture du jour", pay later.
  async function prepareInvoice() {
    if (!selectedCustomer) {
      toast.error("Sélectionnez un client avant de préparer la facture.");
      return;
    }
    setPreparing(true);
    try {
      const response = await fetch("/api/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: buildSaleBody({ collectNow: false }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message ?? "Impossible de préparer la facture.");
      }
      setLastSale(payload.sale as SaleDto);
      toast.success("Facture préparée. Encaissez-la depuis « Factures du jour ».");
      resetOperation();
      await Promise.all([refreshContext(), refreshPending()]);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Impossible de préparer la facture.",
      );
    } finally {
      setPreparing(false);
    }
  }

  async function collectPending(method: PosPaymentMethodValue, paidAmount?: number) {
    if (!collectTarget) return;
    setCollecting(true);
    try {
      const response = await fetch(`/api/sales/${collectTarget.id}/collect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethod: method, paidAmount, reference: null }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message ?? "Impossible d'encaisser la facture.");
      }
      setLastSale(payload.sale as SaleDto);
      toast.success(`Facture ${payload.sale.invoiceNumber} encaissée.`);
      setCollectOpen(false);
      setCollectTarget(null);
      await refreshPending();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Impossible d'encaisser la facture.",
      );
    } finally {
      setCollecting(false);
    }
  }

  function printLastSale() {
    if (!lastSale) {
      toast.error("Aucune facture à imprimer.");
      return;
    }

    window.setTimeout(() => window.print(), 0);
  }

  function printPending(sale: SaleDto) {
    setLastSale(sale);
    window.setTimeout(() => window.print(), 0);
  }

  const paymentMethodLabel =
    posPaymentMethods.find((method) => method.value === paymentMethod)?.label ?? "";

  return (
    <div className="grid gap-4 lg:h-[calc(100vh-8rem)] lg:grid-cols-2 lg:gap-6">
      <div className="flex flex-col gap-4 lg:h-full lg:overflow-hidden">
        <ProductSearch value={search} onChange={setSearch} />
        <div className="lg:flex-1 lg:overflow-y-auto lg:pr-1">
          <ProductGrid products={filteredProducts} onAdd={addToCart} />
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-4 shadow-[0_10px_30px_rgba(15,23,42,0.06)] lg:h-full lg:overflow-y-auto">
        <InvoiceHeader
          userName={context.user.name}
          depotName={context.depot.name}
          stockLocationName={context.stockLocation.name}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
            <CustomerCombobox
              value={selectedCustomer}
              onChange={setSelectedCustomer}
              initialSuggestions={context.customers}
            />
            <CustomerNumberInput onResolved={setSelectedCustomer} />
          </div>
          <PaymentSelector
            paymentMethod={paymentMethod}
            onPaymentMethodChange={setPaymentMethod}
            chequeNumber={chequeNumber}
            onChequeNumberChange={setChequeNumber}
            banque={banque}
            onBanqueChange={setBanque}
            dateEcheance={dateEcheance}
            onDateEcheanceChange={setDateEcheance}
          />
        </div>

        <div className="rounded-2xl border border-border">
          <CartTable
            lines={cartLines}
            operationType={operationType}
            onIncrement={incrementQuantity}
            onDecrement={decrementQuantity}
            onQuantityChange={updateQuantity}
            onDiscountChange={updateDiscount}
            onRemove={removeFromCart}
          />
        </div>

        <CartSummary totals={totals} operationType={operationType} />

        <InvoiceActions
          operationType={operationType}
          disabled={cartLines.length === 0}
          loading={submitting}
          onCheckout={() => setCheckoutOpen(true)}
          onPrint={printLastSale}
          onHold={prepareInvoice}
          holdLoading={preparing}
        />

        <PendingSalesPanel
          sales={pendingSales}
          onSelect={(sale) => {
            setCollectTarget(sale);
            setCollectOpen(true);
          }}
        />

        <div className="rounded-2xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">État du POS</p>
          <p>
            Produits disponibles : {context.products.length} | Dépôt : {context.depot.code}
          </p>
          {context.message && <p className="mt-1 text-amber-700">{context.message}</p>}
          {lastSale && (
            <p className="mt-1">
              Dernière vente : {lastSale.invoiceNumber} · {lastSale.customer?.name ?? "Client"} ·{" "}
              {lastSale.totalTTC.toFixed(2)} MAD
            </p>
          )}
        </div>
      </div>

      <CheckoutDialog
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        netAPayer={totals.netAPayer}
        transferValue={totals.transferValue}
        paymentMethodLabel={paymentMethodLabel}
        paymentMethod={paymentMethod}
        operationType={operationType}
        destinationLabel={selectedCustomer?.name ?? "Client comptoir"}
        submitting={submitting}
        onConfirm={confirmOperation}
      />
      <CollectDialog
        open={collectOpen}
        onOpenChange={(open) => {
          setCollectOpen(open);
          if (!open) setCollectTarget(null);
        }}
        sale={collectTarget}
        submitting={collecting}
        onCollect={collectPending}
        onPrint={() => {
          if (collectTarget) printPending(collectTarget);
        }}
      />
      <ReceiptPrint sale={lastSale} />
    </div>
  );
}
