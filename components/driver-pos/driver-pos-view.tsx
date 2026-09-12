"use client";

import * as React from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CreditCard,
  MessageCircle,
  Printer,
  ShoppingCart,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

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
import { BankAccountCombobox } from "@/components/pos/bank-account-combobox";
import { CartSummary } from "@/components/pos/cart-summary";
import { CartTable } from "@/components/pos/cart-table";
import { CollectDialog } from "@/components/pos/collect-dialog";
import { CustomerCombobox } from "@/components/pos/customer-combobox";
import { CustomerNumberInput } from "@/components/pos/customer-number-input";
import { InvoiceActions } from "@/components/pos/invoice-actions";
import { MobileCustomerPicker } from "@/components/pos/mobile-customer-picker";
import { MobileSupplierPicker } from "@/components/pos/mobile-supplier-picker";
import { PendingSalesPanel } from "@/components/pos/pending-sales-panel";
import { ProductGrid } from "@/components/pos/product-grid";
import { MobileSelectedProduct } from "@/components/pos/mobile-selected-product";
import { ProductSearch } from "@/components/pos/product-search";
import { type SupplierOption } from "@/components/pos/supplier-filter";
import { ReceiptPrint } from "@/components/pos/receipt-print";
import { buildPreviewSale } from "@/lib/pos-preview-sale";
import { useFlyToCart } from "@/components/pos/use-fly-to-cart";
import { posPaymentMethods, type PosPaymentMethodValue } from "@/types/pos";
import { usePosProductSearch } from "@/components/pos/use-pos-product-search";
import { useCompanyIdentity } from "@/hooks/use-company-identity";
import { useDriverRuntime } from "@/hooks/use-driver-runtime";
import { roundMoney } from "@/lib/money";
import { formatCurrency } from "@/lib/utils";
import {
  buildWhatsAppInvoiceMessage,
  buildWhatsAppUrl,
  normalizeWhatsAppPhone,
} from "@/lib/whatsapp-invoice";
import type {
  CustomerDto,
  DriverPosContextDto,
  DriverPosProductDto,
  SaleDto,
} from "@/types/operations-dto";
import type { PosProduct } from "@/types/pos";
// Cart types live only on pos-layout.tsx (the admin POS page) and are
// re-exported as types for reuse - same pattern cart-table.tsx/cart-summary.tsx
// already use. No admin business logic is imported, only these shapes.
import type { CartLineComputed, CartTotals } from "@/components/pos/pos-layout";

type CartLine = {
  productId: string;
  quantity: number;
  discountRate: number;
};

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
  const [paymentMethod, setPaymentMethod] = React.useState<PosPaymentMethodValue>("CASH");
  // BANK_TRANSFER only: chosen active 5141 account id (mandatory before a
  // bank-transfer sale). Only sent when paymentMethod === "BANK_TRANSFER".
  const [bankAccountId, setBankAccountId] = React.useState("");
  const [paidAmount, setPaidAmount] = React.useState("");
  const [lastSale, setLastSale] = React.useState<SaleDto | null>(null);
  // Snapshot of lastSale's own customer phone, captured whenever lastSale is
  // set from a real server response (see resolveCustomerPhone) - WhatsApp
  // sharing reads this instead of the live selectedCustomer, so picking a
  // different customer afterward can never pair the wrong phone with an
  // already-shared invoice.
  const [lastSalePhone, setLastSalePhone] = React.useState<string | null>(null);
  const { identity } = useCompanyIdentity();
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

  // Mobile-only "Fournisseur" filter (< xl). Its options are derived from
  // the driver's already truck-scoped product list, so selecting a supplier
  // can only ever narrow to products that ARE in the truck stock - it never
  // pulls in global catalogue products. Null = "Tous les fournisseurs".
  const [supplierFilter, setSupplierFilter] = React.useState<SupplierOption | null>(null);
  const supplierOptions = React.useMemo<SupplierOption[]>(() => {
    const byId = new Map<string, string>();
    for (const product of allKnownProducts) {
      if (product.supplierId && product.supplierName) {
        byId.set(product.supplierId, product.supplierName);
      }
    }
    return Array.from(byId, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name, "fr"),
    );
  }, [allKnownProducts]);

  const supplierFilteredProducts = React.useMemo(
    () =>
      supplierFilter
        ? filteredProducts.filter((product) => product.supplierId === supplierFilter.id)
        : filteredProducts,
    [filteredProducts, supplierFilter],
  );

  // ProductGrid/ProductCard are shared with the admin POS for the mobile
  // launcher layout. The values still come exclusively from the driver
  // context, whose availableQuantity is the truck-stock quantity.
  const productTiles = React.useMemo<PosProduct[]>(
    () =>
      supplierFilteredProducts.map((product) => ({
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
    [supplierFilteredProducts],
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

  // Adapters so the shared admin cart components (CartTable/CartSummary) can
  // render driver's own cartRows/totals unchanged - no driver pricing/stock
  // logic is touched, only reshaped for these presentational props. Driver
  // has no discount input yet (see computeLine below), so discountUnitAmount
  // is always 0 here and wired to a no-op onDiscountChange further down.
  const cartLinesForTable = React.useMemo<CartLineComputed[]>(
    () =>
      cartRows.map((row) => {
        const baseHT = row.product.salePriceHT * row.quantity;
        return {
          productId: row.productId,
          designation: row.product.name,
          reference: row.product.reference,
          quantity: row.quantity,
          discountUnitAmount: 0,
          unitPriceHT: row.product.salePriceHT,
          unitPriceTTC: row.product.salePriceTTC,
          tauxTVA: row.product.taxRate,
          baseHT,
          discountAmount: 0,
          netHT: row.totals.totalHT,
          tvaAmount: row.totals.taxAmount,
          totalTTC: row.totals.totalTTC,
          transferValue: 0,
        };
      }),
    [cartRows],
  );

  const cartTotalsForSummary = React.useMemo<CartTotals>(
    () => ({
      sousTotalHT: totals.ht,
      remise: 0,
      tva: totals.tax,
      totalTTC: totals.ttc,
      netAPayer: totals.ttc,
      transferValue: 0,
    }),
    [totals],
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

  function incrementQuantity(productId: string) {
    setCart((current) =>
      current.map((line) =>
        line.productId === productId ? { ...line, quantity: line.quantity + 1 } : line,
      ),
    );
  }

  // Same remove-at-zero semantics as the admin CartTable (pos-layout.tsx's
  // decrementQuantity) - a UI interaction, not a stock/sale rule, so this is
  // still purely presentational parity, not a change to driver business logic.
  function decrementQuantity(productId: string) {
    setCart((current) => {
      const line = current.find((item) => item.productId === productId);
      if (!line) return current;
      if (line.quantity <= 1) {
        return current.filter((item) => item.productId !== productId);
      }
      return current.map((item) =>
        item.productId === productId ? { ...item, quantity: item.quantity - 1 } : item,
      );
    });
  }

  function removeProduct(productId: string) {
    setCart((current) => current.filter((line) => line.productId !== productId));
  }

  // WhatsApp sharing only - SaleDto.customer never carries a phone (see
  // saleInclude in lib/server/sales-shared.ts), so it's resolved from
  // whichever already-loaded CustomerDto matches: the currently selected
  // customer first (always the right one right after validateSale), then
  // the small POS context preload. Returns null (never a guess) otherwise -
  // callers fall back to an unaddressed wa.me link.
  function resolveCustomerPhone(customerId: string | null | undefined): string | null {
    if (!customerId) return null;
    if (selectedCustomer?.id === customerId) return selectedCustomer.phone;
    return context.customers.find((customer) => customer.id === customerId)?.phone ?? null;
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
      setLastSalePhone(resolveCustomerPhone(payload.sale.customer?.id));
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
      setLastSalePhone(resolveCustomerPhone(payload.sale.customer?.id));
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
      setLastSalePhone(resolveCustomerPhone(payload.sale.customer?.id));
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
          // Driver POS has no discount input yet (discountRate is always 0
          // here) - renamed only for lib/pos-preview-sale.ts's shared type,
          // no behaviour change. See lib/pos-discount.ts.
          discountUnitAmount: row.discountRate,
          taxRate: row.product.taxRate,
        })),
      }),
    );
    window.setTimeout(() => window.print(), 0);
  }

  function printPending(sale: SaleDto) {
    setLastSale(sale);
    setLastSalePhone(resolveCustomerPhone(sale.customer?.id));
    window.setTimeout(() => window.print(), 0);
  }

  // WhatsApp = share only, never validates/creates/prices anything. Only
  // enabled once lastSale is a real persisted, non-draft sale (never the
  // "preview" ticket buildPreviewSale hands to printCurrentCart, and never a
  // still-DRAFT "Facture du jour" that has no definitive commercial number
  // yet) - see lib/sale-display-number.ts / driverSaleSchema's status rules.
  const canShareWhatsApp = Boolean(
    lastSale && lastSale.id !== "preview" && lastSale.status !== "DRAFT" && lastSale.status !== "CANCELLED",
  );

  function shareLastSaleOnWhatsApp() {
    if (!lastSale || !canShareWhatsApp) return;
    const phone = normalizeWhatsAppPhone(lastSalePhone);
    const message = buildWhatsAppInvoiceMessage(lastSale, identity?.tradeName ?? identity?.name);
    window.open(buildWhatsAppUrl(phone, message), "_blank", "noopener,noreferrer");
  }

  if (!context.canSell) {
    return <StateCard message={context.message ?? "La vente est impossible."} />;
  }

  return (
    <div className="space-y-4 pb-6">
      <div
        ref={cartButtonRef}
        className="fixed top-[calc(env(safe-area-inset-top)+0.75rem)] z-40 lg:hidden"
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
        className="grid grid-cols-2 gap-1 rounded-2xl bg-muted/60 p-1 lg:hidden"
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
        <MobileSelectedProduct product={mobileSelectedProduct} className="lg:hidden" />
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div
          className={`${mobileView === "products" ? "flex" : "hidden"} order-2 min-w-0 flex-col gap-3 lg:order-1 lg:flex lg:h-full lg:gap-4`}
        >
          <ProductSearch value={search} onChange={setSearch} />
          <MobileSupplierPicker
            className="lg:hidden"
            suppliers={supplierOptions}
            value={supplierFilter}
            onChange={setSupplierFilter}
          />
          <ProductGrid
            products={productTiles}
            onAdd={addProductById}
            onAdded={handleMobileProductAdded}
          />
        </div>

        <div
          id="mobile-driver-pos-cart"
          ref={cartSectionRef}
          className={`${mobileView === "cart" ? "block" : "hidden"} order-1 scroll-mt-16 space-y-4 lg:sticky lg:top-20 lg:order-2 lg:block lg:self-start`}
        >
          <Card className="rounded-[24px] border-0 ring-0 shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
            <CardContent className="space-y-4 p-4">
              {/* Desktop-only bonus context (article count + running total) -
                  admin's mobile cart has no equivalent heading at all, so
                  this is hidden on mobile for true visual parity (see
                  InvoiceHeader's own "hidden ... lg:grid" convention). */}
              <div className="hidden items-center justify-between lg:flex">
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

              <div className="grid gap-3 max-lg:grid-cols-[7fr_3fr] max-lg:[&>*]:min-w-0 max-lg:[&>*:last-child]:col-span-2">
                <div className="min-w-0">
                  <div className="hidden lg:block">
                    <CustomerCombobox
                      value={selectedCustomer}
                      onChange={setSelectedCustomer}
                      initialSuggestions={context.customers}
                      placeholder="Client comptoir"
                    />
                  </div>
                  <MobileCustomerPicker
                    className="lg:hidden"
                    value={selectedCustomer}
                    onChange={setSelectedCustomer}
                    initialSuggestions={context.customers}
                    placeholder="Client comptoir"
                  />
                </div>

                <CustomerNumberInput
                  customer={selectedCustomer}
                  onResolved={setSelectedCustomer}
                  placeholder="N° Client"
                  hideLabelOnMobile="lg"
                />

                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <CreditCard aria-hidden="true" className="h-3.5 w-3.5" />
                    Mode de règlement
                  </Label>
                  <Select
                    value={paymentMethod}
                    onValueChange={(value) =>
                      value && setPaymentMethod(value as PosPaymentMethodValue)
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Sélectionner">
                        {() =>
                          posPaymentMethods.find((method) => method.value === paymentMethod)
                            ?.label ?? "Sélectionner"
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {posPaymentMethods.map((method) => (
                        <SelectItem key={method.value} value={method.value}>
                          {method.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

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

              <div className="rounded-2xl border border-border">
                <CartTable
                  lines={cartLinesForTable}
                  operationType="sale"
                  onIncrement={incrementQuantity}
                  onDecrement={decrementQuantity}
                  onQuantityChange={updateQuantity}
                  onDiscountChange={() => {}}
                  onRemove={removeProduct}
                />
              </div>

              <CartSummary totals={cartTotalsForSummary} operationType="sale" />

              <PendingSalesPanel
                sales={pendingSales}
                onSelect={(sale) => {
                  setCollectTarget(sale);
                  setCollectOpen(true);
                }}
              />

              <InvoiceActions
                operationType="sale"
                disabled={cartRows.length === 0}
                loading={busy}
                onCheckout={validateSale}
                onPrint={printCurrentCart}
                onHold={prepareInvoice}
                holdLoading={preparing}
                isCredit={paymentMethod === "CREDIT"}
              />

              {/* Share-only: sends the already-validated invoice to the
                  customer, never re-validates or re-prices it. Driver-only -
                  admin's shared InvoiceActions is untouched. */}
              <Button
                type="button"
                variant="outline"
                disabled={!canShareWhatsApp}
                onClick={shareLastSaleOnWhatsApp}
                className="h-12 w-full rounded-2xl border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
              >
                <MessageCircle aria-hidden="true" className="h-4 w-4" />
                WhatsApp
              </Button>
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
      {/* The round back button in the mobile header already returns to
          /mobile, so this second link is desktop-only (>= lg, where that
          header is hidden) - never a double back affordance on the phone.
          With the link hidden and no "Imprimer" button, this flex row has no
          in-flow children and collapses to zero height (no blank gap). */}
      <div className="flex items-center gap-2">
        <Link
          href="/mobile"
          className="-ml-2 hidden h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent lg:inline-flex"
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
      <div className="hidden rounded-2xl border border-border bg-muted/40 p-4 text-xs lg:grid lg:grid-cols-6 lg:gap-3">
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
