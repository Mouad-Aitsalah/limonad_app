"use client";

import * as React from "react";
import { toast } from "sonner";

import { roundCurrency } from "@/lib/utils";
import type { CounterPosContextDto, SaleDto } from "@/types/operations-dto";
import {
  defaultPaymentMethod,
  posPaymentMethods,
  type PosOperationType,
  type PosPaymentMethodValue,
  type PosProduct,
} from "@/types/pos";
import { ProductSearch } from "@/components/pos/product-search";
import { ProductGrid } from "@/components/pos/product-grid";
import { InvoiceHeader } from "@/components/pos/invoice-header";
import { CustomerSelector } from "@/components/pos/customer-selector";
import { PaymentSelector } from "@/components/pos/payment-selector";
import { CartTable } from "@/components/pos/cart-table";
import { CartSummary } from "@/components/pos/cart-summary";
import { InvoiceActions } from "@/components/pos/invoice-actions";
import { CheckoutDialog } from "@/components/pos/checkout-dialog";
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
  const [customerId, setCustomerId] = React.useState(
    initialContext.customers.find((customer) => customer.type === "COUNTER")?.id ??
      initialContext.customers[0]?.id ??
      "",
  );
  const [paymentMethod, setPaymentMethod] =
    React.useState<PosPaymentMethodValue>(defaultPaymentMethod);
  const [chequeNumber, setChequeNumber] = React.useState("");
  const [banque, setBanque] = React.useState("");
  const [dateEcheance, setDateEcheance] = React.useState("");
  const [checkoutOpen, setCheckoutOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [lastSale, setLastSale] = React.useState<SaleDto | null>(null);

  const operationType: PosOperationType = "sale";
  const sellableProducts = React.useMemo(
    () => mapContextProductsToPosProducts(context.products),
    [context.products],
  );
  const productById = React.useMemo(() => {
    return new Map(sellableProducts.map((product) => [product.id, product]));
  }, [sellableProducts]);
  const selectedCustomer = React.useMemo(
    () => context.customers.find((customer) => customer.id === customerId) ?? null,
    [context.customers, customerId],
  );

  const filteredProducts = React.useMemo(() => {
    const query = normalizeSearch(search);
    if (query.length === 0) return sellableProducts;

    return sellableProducts.filter((product) => {
      const designation = normalizeSearch(product.designation);
      const reference = normalizeSearch(product.reference);
      const barcode = normalizeSearch(product.barcode ?? "");

      return (
        designation.includes(query) ||
        reference.includes(query) ||
        barcode.includes(query)
      );
    });
  }, [search, sellableProducts]);

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

  function addToCart(productId: string) {
    const product = productById.get(productId);
    if (!product) return;

    setCart((prev) => {
      const existing = prev.find((line) => line.productId === productId);
      if (existing) {
        if (existing.quantity >= product.quantiteStock) return prev;
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
    const product = productById.get(productId);
    const max = product?.quantiteStock ?? quantity;

    setCart((prev) =>
      prev.map((line) =>
        line.productId === productId
          ? { ...line, quantity: Math.min(Math.max(1, quantity), max) }
          : line,
      ),
    );
  }

  function incrementQuantity(productId: string) {
    setCart((prev) =>
      prev.map((line) => {
        if (line.productId !== productId) return line;
        const max = productById.get(productId)?.quantiteStock ?? line.quantity + 1;
        return { ...line, quantity: Math.min(line.quantity + 1, max) };
      }),
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
  }

  async function refreshContext() {
    const refreshed = await fetch("/api/sales/context", { cache: "no-store" });
    const payload = await refreshed.json();
    if (!refreshed.ok) {
      throw new Error(payload.message ?? "Impossible de rafraîchir le stock.");
    }

    const nextContext = payload.context as CounterPosContextDto;
    setContext(nextContext);
    setCustomerId((currentCustomerId) =>
      nextContext.customers.some((customer) => customer.id === currentCustomerId)
        ? currentCustomerId
        : nextContext.customers.find((customer) => customer.type === "COUNTER")?.id ??
          nextContext.customers[0]?.id ??
          "",
    );
  }

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
        body: JSON.stringify({
          customerId: selectedCustomer.id,
          paymentMethod,
          paidAmount,
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
        }),
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

  function printLastSale() {
    if (!lastSale) {
      toast.error("Veuillez d'abord encaisser la vente.");
      return;
    }

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
          <CustomerSelector
            customers={context.customers}
            customerId={customerId}
            onChange={setCustomerId}
          />
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
      <ReceiptPrint sale={lastSale} />
    </div>
  );
}
