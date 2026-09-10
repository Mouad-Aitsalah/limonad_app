"use client";

import * as React from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Printer,
  ShoppingCart,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BankAccountCombobox } from "@/components/pos/bank-account-combobox";
import { CollectDialog } from "@/components/pos/collect-dialog";
import { CustomerCombobox } from "@/components/pos/customer-combobox";
import { CustomerNumberInput } from "@/components/pos/customer-number-input";
import { PendingSalesPanel } from "@/components/pos/pending-sales-panel";
import { ProductGrid } from "@/components/pos/product-grid";
import { MobileSelectedProduct } from "@/components/pos/mobile-selected-product";
import { ProductSearch } from "@/components/pos/product-search";
import { ReceiptPrint } from "@/components/pos/receipt-print";
import { buildPreviewSale } from "@/lib/pos-preview-sale";
import { useFlyToCart } from "@/components/pos/use-fly-to-cart";
import type { PosPaymentMethodValue } from "@/types/pos";
import { usePosProductSearch } from "@/components/pos/use-pos-product-search";
import { ProductMedia } from "@/components/products/product-media";
import { useDriverRuntime } from "@/hooks/use-driver-runtime";
import { roundMoney } from "@/lib/money";
import { posStockTone } from "@/lib/pos-stock-display";
import { formatCurrency } from "@/lib/utils";
import type {
  CustomerDto,
  DriverPosContextDto,
  DriverPosProductDto,
  SaleDto,
} from "@/types/operations-dto";
import type { PosProduct } from "@/types/pos";

type CartLine = {
  productId: string;
  quantity: number;
  discountRate: number;
};

const paymentMethods = [
  { value: "CASH", label: "Especes" },
  { value: "CARD", label: "Carte" },
  { value: "CHECK", label: "Cheque" },
  { value: "BANK_TRANSFER", label: "Virement" },
  { value: "CREDIT", label: "Credit" },
  { value: "MIXED", label: "Mixte" },
];

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function DriverPosView({
  initialContext,
  initialCustomerId,
}: {
  initialContext: DriverPosContextDto;
  initialCustomerId?: string | null;
}) {
  const driverRuntime = useDriverRuntime();
  const [context, setContext] = React.useState(initialContext);
  const [search, setSearch] = React.useState("");
  const [cart, setCart] = React.useState<CartLine[]>([]);
  // Last product tapped in the mobile "Produits" launcher - drives the
  // floating notification only (never the cart, which stays multi-line).
  const [lastAddedProductId, setLastAddedProductId] = React.useState<string | null>(null);
  const [mobileView, setMobileView] = React.useState<"products" | "cart">("cart");
  const cartSectionRef = React.useRef<HTMLDivElement>(null);
  const cartButtonRef = React.useRef<HTMLDivElement>(null);
  const [cartPulse, setCartPulse] = React.useState(false);
  const cartPulseTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Phase 3: the fully-resolved customer object (or null for "Client
  // comptoir") - kept as its own state, not derived from
  // context.customers.find(...), because context.customers is now only a
  // small preload (see getPosCustomerPreload); a customer found via the
  // combobox's search fallback must stay selected even though it was never
  // in that preloaded list. The server guarantees initialCustomerId (e.g. a
  // tour-visit deep link) is present in the initial preload either way.
  const [selectedCustomer, setSelectedCustomer] = React.useState<CustomerDto | null>(() =>
    resolveInitialCustomer(initialContext, initialCustomerId),
  );
  const [paymentMethod, setPaymentMethod] = React.useState("CASH");
  // BANK_TRANSFER only: chosen active 5141 account id (mandatory before a
  // bank-transfer sale). Only sent when paymentMethod === "BANK_TRANSFER".
  const [bankAccountId, setBankAccountId] = React.useState("");
  const [paidAmount, setPaidAmount] = React.useState("");
  const [lastSale, setLastSale] = React.useState<SaleDto | null>(null);
  const [busy, setBusy] = React.useState(false);
  // "Factures du jour" - server-persisted DRAFT truck sales awaiting collection.
  const [pendingSales, setPendingSales] = React.useState<SaleDto[]>([]);
  const [preparing, setPreparing] = React.useState(false);
  const [collectTarget, setCollectTarget] = React.useState<SaleDto | null>(null);
  const [collectOpen, setCollectOpen] = React.useState(false);
  const [collecting, setCollecting] = React.useState(false);
  const flyToCart = useFlyToCart();

  React.useEffect(() => {
    return () => {
      if (cartPulseTimeoutRef.current) clearTimeout(cartPulseTimeoutRef.current);
    };
  }, []);
  // Stable for one sale attempt (F5): kept identical across a network retry
  // of validateSale, only replaced once a sale has actually gone through and
  // the cart is cleared for the next one. A ref so it is synchronously
  // current the instant validateSale reads it, and never triggers a
  // re-render on its own.
  const idempotencyKeyRef = React.useRef<string>(crypto.randomUUID());

  // Phase 3: same fallback as the counter POS (usePosProductSearch) - falls
  // back to a truck-scoped server search when the preloaded product list
  // was truncated, instead of only ever searching an incomplete list.
  const { products: filteredProducts, allKnownProducts } = usePosProductSearch(
    context.products,
    search,
    {
      truncated: context.productsTruncated,
      locationId: context.stockLocationId,
      normalize,
    },
  );

  const productById = React.useMemo(
    () => new Map(allKnownProducts.map((product) => [product.id, product])),
    [allKnownProducts],
  );

  // ProductGrid/ProductCard are shared with the admin POS for the mobile
  // launcher layout. The values still come exclusively from the driver
  // context, whose availableQuantity is the truck-stock quantity.
  const productTiles = React.useMemo<PosProduct[]>(
    () =>
      filteredProducts.map((product) => ({
        id: product.id,
        reference: product.reference,
        barcode: product.barcode,
        designation: product.name,
        prixVenteHT: product.salePriceHT,
        prixVenteTTC: product.salePriceTTC,
        tauxTVA: product.taxRate,
        quantiteStock: product.availableQuantity,
        imageUrl: product.imageUrl,
      })),
    [filteredProducts],
  );

  const cartRows = React.useMemo(
    () =>
      cart
        .map((line) => {
          const product = productById.get(line.productId);
          if (!product) return null;
          return { ...line, product, totals: computeLine(product, line) };
        })
        .filter(
          (
            line,
          ): line is CartLine & {
            product: DriverPosProductDto;
            totals: ReturnType<typeof computeLine>;
          } => Boolean(line),
        ),
    [cart, productById],
  );

  const totals = React.useMemo(
    () => ({
      ht: round(cartRows.reduce((sum, row) => sum + row.totals.totalHT, 0)),
      tax: round(cartRows.reduce((sum, row) => sum + row.totals.taxAmount, 0)),
      ttc: round(cartRows.reduce((sum, row) => sum + row.totals.totalTTC, 0)),
      quantity: cartRows.reduce((sum, row) => sum + row.quantity, 0),
    }),
    [cartRows],
  );

  const mobileSelectedProduct = React.useMemo(() => {
    // Feedback for the LAST tapped product only - its live cart quantity
    // and line total - not cartRows[0] and not the whole cart.
    if (!lastAddedProductId) return null;
    const row = cartRows.find((line) => line.productId === lastAddedProductId);
    if (!row) return null;

    return {
      designation: row.product.name,
      quantity: row.quantity,
      priceTTC: row.product.salePriceTTC,
      imageUrl: row.product.imageUrl,
    };
  }, [cartRows, lastAddedProductId]);

  // Negative truck stock is allowed: cart quantity is never capped at the
  // product's on-hand quantity, only floored at 1.
  function addProduct(product: DriverPosProductDto) {
    setCart((current) => {
      const existing = current.find((line) => line.productId === product.id);
      if (!existing) {
        return [...current, { productId: product.id, quantity: 1, discountRate: 0 }];
      }
      return current.map((line) =>
        line.productId === product.id ? { ...line, quantity: line.quantity + 1 } : line,
      );
    });
    setLastAddedProductId(product.id);
  }

  function addProductById(productId: string) {
    const product = productById.get(productId);
    if (!product) return false;
    addProduct(product);
    return true;
  }

  function showMobileCartFeedback() {
    setCartPulse(true);
    if (cartPulseTimeoutRef.current) clearTimeout(cartPulseTimeoutRef.current);
    cartPulseTimeoutRef.current = setTimeout(() => setCartPulse(false), 700);
  }

  function handleMobileProductAdded(product: PosProduct, sourceElement: HTMLElement) {
    flyToCart({
      product,
      sourceElement,
      cartElement: cartButtonRef.current,
      onComplete: showMobileCartFeedback,
    });
  }

  function openMobileCart() {
    setMobileView("cart");
    requestAnimationFrame(() => {
      cartSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function updateQuantity(productId: string, quantity: number) {
    setCart((current) =>
      current.map((line) =>
        line.productId === productId
          ? { ...line, quantity: Math.max(1, quantity) }
          : line,
      ),
    );
  }

  function removeProduct(productId: string) {
    setCart((current) => current.filter((line) => line.productId !== productId));
  }

  async function refreshContext() {
    // Pass the current selection so the server-bounded preload guarantees
    // it stays present (same reasoning as the initial load) - a refresh
    // must never silently drop who's selected.
    const query = selectedCustomer ? `?customerId=${encodeURIComponent(selectedCustomer.id)}` : "";
    const refreshed = await fetch(`/api/driver/pos${query}`, { cache: "no-store" });
    const refreshedPayload = (await refreshed.json()) as { context?: DriverPosContextDto };
    if (refreshedPayload.context) setContext(refreshedPayload.context);
  }

  function buildSaleBody(extra: Record<string, unknown>) {
    return JSON.stringify({
      customerId: selectedCustomer?.id ?? null,
      paymentMethod,
      paidAmount: paidAmount ? Number(paidAmount) : undefined,
      ...(paymentMethod === "BANK_TRANSFER"
        ? { bankAccountingAccountId: bankAccountId || null }
        : {}),
      lines: cart,
      idempotencyKey: idempotencyKeyRef.current,
      ...extra,
    });
  }

  function resetForNextSale() {
    setCart([]);
    setLastAddedProductId(null);
    setPaidAmount("");
    setPaymentMethod("CASH");
    setBankAccountId("");
    idempotencyKeyRef.current = crypto.randomUUID();
  }

  async function refreshPending() {
    try {
      const response = await fetch("/api/driver/sales/pending", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { sales?: SaleDto[] };
      setPendingSales(payload.sales ?? []);
    } catch {
      // non-fatal
    }
  }

  React.useEffect(() => {
    let active = true;
    fetch("/api/driver/sales/pending", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { sales: [] }))
      .then((payload: { sales?: SaleDto[] }) => {
        if (active) setPendingSales(payload.sales ?? []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  async function validateSale() {
    if (paymentMethod === "BANK_TRANSFER" && !bankAccountId) {
      toast.error(
        "Veuillez sélectionner le compte bancaire qui a reçu le virement.",
      );
      return;
    }
    const handledCustomerId = selectedCustomer?.id ?? null;
    setBusy(true);
    try {
      const response = await fetch("/api/driver/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: buildSaleBody({}),
      });
      const payload = (await response.json()) as { sale?: SaleDto; message?: string };
      if (!response.ok || !payload.sale) {
        toast.error(payload.message ?? "Impossible de valider la vente.");
        return;
      }

      setLastSale(payload.sale);
      resetForNextSale();
      if (handledCustomerId) {
        driverRuntime.markCustomerHandled(handledCustomerId);
      }
      toast.success(`Vente ${payload.sale.invoiceNumber} validee.`);
      await Promise.allSettled([
        refreshContext(),
        driverRuntime.refreshCurrentTour(),
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function prepareInvoice() {
    setPreparing(true);
    try {
      const response = await fetch("/api/driver/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: buildSaleBody({ collectNow: false }),
      });
      const payload = (await response.json()) as { sale?: SaleDto; message?: string };
      if (!response.ok || !payload.sale) {
        toast.error(payload.message ?? "Impossible de preparer la facture.");
        return;
      }
      setLastSale(payload.sale);
      resetForNextSale();
      toast.success("Facture preparee. Encaissez-la depuis « Factures du jour ».");
      await Promise.allSettled([refreshContext(), refreshPending()]);
    } finally {
      setPreparing(false);
    }
  }

  async function collectPending(
    method: PosPaymentMethodValue,
    collectPaidAmount?: number,
    bankAccountingAccountId?: string,
  ) {
    if (!collectTarget) return;
    setCollecting(true);
    try {
      const response = await fetch(`/api/driver/sales/${collectTarget.id}/collect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentMethod: method,
          paidAmount: collectPaidAmount,
          reference: null,
          ...(method === "BANK_TRANSFER"
            ? { bankAccountingAccountId: bankAccountingAccountId ?? null }
            : {}),
        }),
      });
      const payload = (await response.json()) as { sale?: SaleDto; message?: string };
      if (!response.ok || !payload.sale) {
        toast.error(payload.message ?? "Impossible d'encaisser la facture.");
        return;
      }
      setLastSale(payload.sale);
      toast.success(`Facture ${payload.sale.invoiceNumber} encaissee.`);
      setCollectOpen(false);
      setCollectTarget(null);
      await Promise.allSettled([refreshPending(), driverRuntime.refreshCurrentTour()]);
    } finally {
      setCollecting(false);
    }
  }

  function printLastSale() {
    if (!lastSale) {
      toast.error("Aucune facture a imprimer.");
      return;
    }

    window.setTimeout(() => window.print(), 0);
  }

  // "Imprimer" from the driver cart: same behaviour as the counter POS.
  // Prints the ticket for the cart as it stands - built entirely in the
  // browser, keeping the driver / camion / tournee / client context. It
  // never touches truck stock, ends the tour, collects, creates a second
  // sale, changes quantities, or locks the cart.
  function printCurrentCart() {
    if (cartRows.length === 0) {
      printLastSale();
      return;
    }
    const bankAccount =
      paymentMethod === "BANK_TRANSFER"
        ? context.bankAccounts.find((account) => account.id === bankAccountId) ?? null
        : null;
    setLastSale(
      buildPreviewSale({
        displayNumber: lastSale?.displayNumber ?? "—",
        createdByUserName: context.driver.name,
        customer: selectedCustomer
          ? {
              id: selectedCustomer.id,
              code: selectedCustomer.code,
              name: selectedCustomer.name,
            }
          : null,
        driver: { id: context.driver.id, name: context.driver.name },
        truck: context.truck
          ? {
              id: context.truck.id,
              code: context.truck.code,
              registration: context.truck.registration,
            }
          : null,
        tour: context.tour
          ? {
              id: context.tour.id,
              code: context.tour.code,
              status: context.tour.status,
              date: "",
            }
          : null,
        paymentMethod,
        bankAccount,
        lines: cartRows.map((row) => ({
          productId: row.productId,
          productReference: row.product.reference,
          productName: row.product.name,
          quantity: row.quantity,
          unitPriceHT: row.product.salePriceHT,
          discountRate: row.discountRate,
          taxRate: row.product.taxRate,
        })),
      }),
    );
    window.setTimeout(() => window.print(), 0);
  }

  function printPending(sale: SaleDto) {
    setLastSale(sale);
    window.setTimeout(() => window.print(), 0);
  }

  if (!context.canSell) {
    return <StateCard message={context.message ?? "La vente est impossible."} />;
  }

  return (
    <div className="space-y-4 pb-6">
      <div
        ref={cartButtonRef}
        className="fixed top-[calc(env(safe-area-inset-top)+0.75rem)] z-40 xl:hidden"
        style={{ right: "max(0.75rem, env(safe-area-inset-right))" }}
      >
        <Button
          type="button"
          size="icon"
          aria-label={`Voir le panier, ${totals.quantity} article${totals.quantity > 1 ? "s" : ""}`}
          onClick={openMobileCart}
          className="relative h-11 w-11 rounded-full shadow-lg"
        >
          <ShoppingCart aria-hidden="true" className="h-5 w-5" />
          <span
            className={`absolute -top-1 -right-1 grid min-h-5 min-w-5 place-items-center rounded-full border-2 border-background bg-foreground px-1 text-[10px] font-bold text-background ${cartPulse ? "motion-safe:animate-bounce" : ""}`}
          >
            {totals.quantity}
          </span>
        </Button>
      </div>

      <DriverInvoiceHeader
        driverName={context.driver.name}
        truckCode={context.truck?.code ?? "-"}
        truckRegistration={context.truck?.registration ?? "-"}
        tourCode={context.tour?.code ?? null}
        invoiceLabel={lastSale?.displayNumber ?? "—"}
        lastSale={lastSale}
        onPrintLastSale={printLastSale}
      />

      <div
        className="grid grid-cols-2 gap-1 rounded-2xl bg-muted/60 p-1 xl:hidden"
        role="tablist"
        aria-label="Vues du point de vente chauffeur"
      >
        <Button
          type="button"
          role="tab"
          aria-selected={mobileView === "products"}
          variant={mobileView === "products" ? "default" : "ghost"}
          onClick={() => setMobileView("products")}
          className="h-10 rounded-xl text-sm"
        >
          Les produits
        </Button>
        <Button
          type="button"
          role="tab"
          aria-selected={mobileView === "cart"}
          variant={mobileView === "cart" ? "default" : "ghost"}
          onClick={() => setMobileView("cart")}
          className="h-10 rounded-xl text-sm"
        >
          Panier ({totals.quantity})
        </Button>
      </div>

      {mobileView === "products" && (
        <MobileSelectedProduct product={mobileSelectedProduct} className="xl:hidden" />
      )}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div
          className={`${mobileView === "products" ? "block" : "hidden"} order-2 space-y-4 xl:order-1 xl:block`}
        >
          <div className="space-y-3 xl:hidden">
            <ProductSearch value={search} onChange={setSearch} />
            <ProductGrid
              products={productTiles}
              onAdd={addProductById}
              onAdded={handleMobileProductAdded}
            />
          </div>
          <Card className="hidden overflow-hidden rounded-[24px] border-0 ring-0 shadow-[0_16px_40px_rgba(15,23,42,0.08)] xl:block">
            <CardContent className="space-y-4 p-4">
              <div className="space-y-2">
                <Label>Recherche produit</Label>
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Nom, reference ou code-barres"
                  className="h-10 rounded-2xl"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filteredProducts.map((product) => {
                  const cartLine = cart.find((line) => line.productId === product.id);
                  const inCartQuantity = cartLine?.quantity ?? 0;
                  // Negative truck stock is allowed: the tile is never
                  // disabled because of stock, the quantity is only shown in
                  // red at 0 / negative.
                  const tone = posStockTone(product.availableQuantity);

                  return (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => addProduct(product)}
                      className="group overflow-hidden rounded-[22px] border border-border bg-card text-left transition hover:border-emerald-200 hover:shadow-[0_10px_24px_rgba(16,185,129,0.14)]"
                    >
                      <ProductPhoto product={product} />
                      <div className="space-y-3 p-3">
                        <div>
                          <p className="line-clamp-2 text-sm font-semibold text-foreground">
                            {product.name}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {product.reference}
                            {product.barcode ? ` • ${product.barcode}` : ""}
                          </p>
                        </div>

                        <div className="flex items-end justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-emerald-700">
                              {formatCurrency(product.salePriceTTC)}
                            </p>
                            <p className={`text-xs ${tone.textClassName}`}>
                              {tone.label(product.availableQuantity)}
                            </p>
                          </div>
                          <Badge variant="secondary">
                            {inCartQuantity > 0 ? `${inCartQuantity} au panier` : "Ajouter"}
                          </Badge>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        <div
          id="mobile-driver-pos-cart"
          ref={cartSectionRef}
          className={`${mobileView === "cart" ? "block" : "hidden"} order-1 scroll-mt-16 space-y-4 xl:sticky xl:top-20 xl:order-2 xl:block xl:self-start`}
        >
          <Card className="rounded-[24px] border-0 ring-0 shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
            <CardContent className="space-y-4 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-heading text-lg font-semibold text-foreground">
                    Panier chauffeur
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {totals.quantity} article{totals.quantity > 1 ? "s" : ""}
                  </p>
                </div>
                <Badge variant="outline">{formatCurrency(totals.ttc)}</Badge>
              </div>

              <div className="grid gap-3 max-lg:grid-cols-2 max-lg:[&>*:last-child]:col-span-2">
                <CustomerCombobox
                  value={selectedCustomer}
                  onChange={setSelectedCustomer}
                  initialSuggestions={context.customers}
                  placeholder="Client comptoir"
                />

                <CustomerNumberInput
                  customer={selectedCustomer}
                  onResolved={setSelectedCustomer}
                />

                <Field label="Paiement">
                  <select
                    value={paymentMethod}
                    onChange={(event) => setPaymentMethod(event.target.value)}
                    className="h-10 rounded-2xl border border-input bg-background px-3 text-sm"
                  >
                    {paymentMethods.map((method) => (
                      <option key={method.value} value={method.value}>
                        {method.label}
                      </option>
                    ))}
                  </select>
                </Field>

                {paymentMethod === "BANK_TRANSFER" && (
                  <Field label="Compte bancaire *">
                    <BankAccountCombobox
                      accounts={context.bankAccounts}
                      accountId={bankAccountId}
                      onChange={setBankAccountId}
                    />
                    {context.bankAccounts.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Aucun compte 5141 actif.
                      </p>
                    ) : null}
                  </Field>
                )}

                {paymentMethod === "MIXED" && (
                  <Field label="Montant encaissé">
                    <Input
                      type="number"
                      min={0}
                      value={paidAmount}
                      onChange={(event) => setPaidAmount(event.target.value)}
                      className="h-10 rounded-2xl"
                    />
                  </Field>
                )}
              </div>

              <div className="space-y-3">
                {cartRows.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                    Ajoutez des produits depuis le stock du camion pour commencer la vente.
                  </div>
                ) : (
                  cartRows.map((row) => (
                    <div
                      key={row.productId}
                      className="rounded-[22px] border border-border bg-muted/20 p-3"
                    >
                      <div className="flex gap-3">
                        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-muted">
                          <ProductPhoto product={row.product} compact />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-foreground">
                                {row.product.name}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {row.product.reference}
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Supprimer ${row.product.name}`}
                              onClick={() => removeProduct(row.productId)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>

                          <div className="mt-3 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="icon-sm"
                                onClick={() => updateQuantity(row.productId, row.quantity - 1)}
                              >
                                -
                              </Button>
                              <Input
                                type="number"
                                min={1}
                                value={row.quantity}
                                onFocus={(event) => {
                                  const input = event.currentTarget;
                                  requestAnimationFrame(() => {
                                    try {
                                      input.select();
                                    } catch {
                                      /* input detached */
                                    }
                                  });
                                }}
                                onChange={(event) =>
                                  updateQuantity(row.productId, Number(event.target.value))
                                }
                                className="h-9 w-20 rounded-xl text-center"
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="icon-sm"
                                onClick={() => updateQuantity(row.productId, row.quantity + 1)}
                              >
                                +
                              </Button>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-semibold text-foreground">
                                {formatCurrency(row.totals.totalTTC)}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Dispo: {row.product.availableQuantity}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="space-y-2 rounded-[22px] bg-muted/50 p-4 text-sm">
                <Summary label="Total HT" value={totals.ht} />
                <Summary label="TVA" value={totals.tax} />
                <div className="mt-2 flex items-center justify-between border-t border-border pt-3">
                  <span className="text-base font-semibold text-foreground">Total à payer</span>
                  <span className="text-2xl font-bold text-emerald-700 tabular-nums">
                    {formatCurrency(totals.ttc)}
                  </span>
                </div>
              </div>

              <PendingSalesPanel
                sales={pendingSales}
                onSelect={(sale) => {
                  setCollectTarget(sale);
                  setCollectOpen(true);
                }}
              />

              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={preparing || cartRows.length === 0}
                    onClick={prepareInvoice}
                    className="h-12 rounded-2xl"
                  >
                    {preparing ? "..." : "Préparer"}
                  </Button>
                  <Button
                    type="button"
                    disabled={busy || cartRows.length === 0}
                    onClick={validateSale}
                    className="h-12 rounded-2xl"
                  >
                    <ShoppingCart className="h-4 w-4" />
                    Valider
                  </Button>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={cartRows.length === 0 && !lastSale}
                  onClick={printCurrentCart}
                  className="h-12 w-full rounded-2xl"
                >
                  <Printer className="h-4 w-4" />
                  Imprimer
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <CollectDialog
        open={collectOpen}
        onOpenChange={(open) => {
          setCollectOpen(open);
          if (!open) setCollectTarget(null);
        }}
        sale={collectTarget}
        submitting={collecting}
        bankAccounts={context.bankAccounts}
        onCollect={collectPending}
        onPrint={() => {
          if (collectTarget) printPending(collectTarget);
        }}
      />
      <ReceiptPrint sale={lastSale} />
    </div>
  );
}

function DriverInvoiceHeader({
  driverName,
  truckCode,
  truckRegistration,
  tourCode,
  invoiceLabel,
  lastSale,
  onPrintLastSale,
}: {
  driverName: string;
  truckCode: string;
  truckRegistration: string;
  tourCode: string | null;
  invoiceLabel: string;
  lastSale: SaleDto | null;
  onPrintLastSale: () => void;
}) {
  const now = new Date();
  const date = now.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const heure = now.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Link
          href="/mobile"
          className="-ml-2 inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Point de vente
        </Link>
        {lastSale ? (
          <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={onPrintLastSale}>
            <Printer aria-hidden="true" className="h-4 w-4" />
            Imprimer
          </Button>
        ) : null}
      </div>

      {/* Metadata strip: hidden on mobile (< xl) so the phone cart goes
          straight to Client / N° client / Paiement / panier. Screen display
          only - depot / stock-source stay in the sale payload and on the
          printed ticket; "Stock source" (which just repeated the truck code)
          was dropped from this strip. */}
      <div className="hidden rounded-2xl border border-border bg-muted/40 p-4 text-xs xl:grid xl:grid-cols-6 xl:gap-3">
        <HeaderMetric label="N° Facture" value={invoiceLabel} strong />
        <HeaderMetric label="Chauffeur" value={driverName} />
        <HeaderMetric label="Date" value={date} suppressHydrationWarning />
        <HeaderMetric label="Heure" value={heure} suppressHydrationWarning />
        <HeaderMetric label="Camion" value={`${truckCode} · ${truckRegistration}`} />
        {tourCode ? <HeaderMetric label="Tournée" value={tourCode} /> : null}
      </div>
    </section>
  );
}

function HeaderMetric({
  label,
  value,
  strong = false,
  suppressHydrationWarning = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
  suppressHydrationWarning?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        suppressHydrationWarning={suppressHydrationWarning}
        className={`truncate ${strong ? "font-semibold tabular-nums" : "font-medium"}`}
      >
        {value}
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Summary({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "font-semibold text-foreground" : ""}`}>
      <span>{label}</span>
      <span>{formatCurrency(value)}</span>
    </div>
  );
}

function ProductPhoto({
  product,
  compact = false,
}: {
  product: DriverPosProductDto;
  compact?: boolean;
}) {
  return (
    <ProductMedia
      imageUrl={product.imageUrl}
      alt={`Photo du produit ${product.name}`}
      fit="contain"
      className={compact ? "h-full rounded-2xl border-0" : "h-36 rounded-[18px]"}
      imageClassName={compact ? "p-2" : "p-4 transition-transform duration-200 group-hover:scale-[1.03]"}
      iconClassName={compact ? "h-6 w-6" : "h-8 w-8"}
    />
  );
}

function StateCard({ message }: { message: string }) {
  return (
    <Card className="rounded-[24px] ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <AlertTriangle className="h-10 w-10 text-muted-foreground/40" />
        <p className="max-w-md text-sm text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}

function computeLine(product: DriverPosProductDto, line: CartLine) {
  const grossHT = product.salePriceHT * line.quantity;
  const discountAmount = round(grossHT * (line.discountRate / 100));
  const totalHT = round(grossHT - discountAmount);
  const taxAmount = round(totalHT * (product.taxRate / 100));
  return { totalHT, taxAmount, totalTTC: round(totalHT + taxAmount) };
}

function resolveInitialCustomer(
  context: DriverPosContextDto,
  initialCustomerId?: string | null,
): CustomerDto | null {
  if (!initialCustomerId) {
    return null;
  }

  return context.customers.find((customer) => customer.id === initialCustomerId) ?? null;
}

// F8-B: delegates to the shared decimal-based engine (lib/money.ts) instead
// of `Math.round(value * 100) / 100`. Kept under this same local name so
// every call site in this file needed zero changes.
function round(value: number) {
  return roundMoney(value);
}
