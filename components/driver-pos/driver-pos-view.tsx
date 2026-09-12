"use client";

import * as React from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CreditCard,
  LoaderCircle,
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
import { NetworkStatusBadge } from "@/components/driver-pos/network-status-badge";
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
import { useAuth } from "@/hooks/use-auth";
import { useCompanyIdentity } from "@/hooks/use-company-identity";
import { useDriverRuntime } from "@/hooks/use-driver-runtime";
import { useNetworkState } from "@/hooks/use-network-status";
import {
  countPendingOfflineSales,
  createOfflineSale,
  describeOfflineSaleError,
  getOfflineDbDiagnostic,
  getOfflineSales,
  hydrateDriverOfflineCache,
  loadDriverPosContext,
  type OfflineDbDiagnostic,
} from "@/lib/offline/driver-pos";
import { roundMoney } from "@/lib/money";
import { shareInvoicePdf } from "@/lib/share-invoice";
import { formatCurrency } from "@/lib/utils";
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

// Phase 2 - "9. VALIDATION / ENCAISSEMENT OFFLINE". Still used, unchanged,
// by prepareInvoice/collectPending - Phase 3 only carves out a CASH
// exception inside validateSale (see OFFLINE_PAYMENT_METHOD_MESSAGE below).
const OFFLINE_SALE_MESSAGE = "Les ventes hors connexion seront disponibles à l'étape suivante.";
// Phase 3 - "2. AUTRES MODES DE PAIEMENT HORS CONNEXION": every payment
// method except CASH still requires a connection, but with its own message -
// this is not "not built yet" (OFFLINE_SALE_MESSAGE above), it is a real,
// permanent V1 rule.
const OFFLINE_PAYMENT_METHOD_MESSAGE = "Ce mode de règlement nécessite une connexion Internet.";
const OFFLINE_SAVE_ERROR_MESSAGE =
  "Impossible d'enregistrer la vente hors connexion. Réessayez.";

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
  const { currentUser } = useAuth();
  const networkState = useNetworkState();
  const [context, setContext] = React.useState(initialContext);
  // Phase 2: which side the current `context` actually came from - "server"
  // right after the initial load (always true - see app/driver/pos/page.tsx,
  // a Server Component that itself needs a working connection to render at
  // all), or "cache" once a drop in connectivity made loadDriverPosContext
  // fall back to SQLite. `context` itself is unchanged either way - same
  // DriverPosContextDto shape, same UI below (see this task's own "3. NE PAS
  // DUPLIQUER L'UI").
  const [contextSource, setContextSource] = React.useState<"server" | "cache">("server");
  const [cacheSyncedAt, setCacheSyncedAt] = React.useState<string | null>(null);
  // Only ever set when the current `context` in memory could NOT be
  // refreshed (server unreachable AND the cache read didn't produce a
  // usable, non-empty result) - see this task's "14. CACHE ABSENT" and
  // "7. NE JAMAIS EFFACER UN CONTEXTE VALIDE". Checked at render time
  // together with `context.products.length === 0` so a perfectly good,
  // already-loaded POS is never yanked away by a later failed attempt -
  // it only ever blocks rendering when there is truly nothing to show.
  const [contextUnavailable, setContextUnavailable] = React.useState(false);
  // TEMPORARY dev diagnostic (Phase 2 bug hunt - "10.10-11" of that task) -
  // the raw row counts from the last cache read attempt, shown under the
  // network badge so this can be checked on a real device without
  // DevTools. Remove once the offline read path is confirmed solid.
  const [cacheDiagnostic, setCacheDiagnostic] = React.useState<
    { products: number; customers: number; stock: number } | "unavailable" | null
  >(null);
  // TEMPORARY dev diagnostic (Phase 3 bug hunt - "no such table:
  // offline_sales") - the migrated schema's actual user_version and
  // per-table presence, read once on mount. Remove once the migration path
  // is confirmed solid on every device.
  const [dbDiagnostic, setDbDiagnostic] = React.useState<OfflineDbDiagnostic | null>(null);
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
  // Phase 3: set only right after a confirmed OFFLINE sale, holding its
  // "OFF-..." local reference - lets <ReceiptPrint> show "TICKET HORS
  // CONNEXION" instead of a real invoice layout (see "16. IMPRESSION
  // OFFLINE"). Cleared every time `lastSale` is replaced by anything else
  // (a real server sale, or a live unconfirmed cart preview).
  const [offlineTicketReference, setOfflineTicketReference] = React.useState<string | null>(null);
  // Phase 3 - "15. COMPTEUR DE VENTES EN ATTENTE": always read from SQLite,
  // never derived from in-memory state, so it stays correct across a remount
  // (see sales-store.ts's countPendingOfflineSales / this task's "TEST C").
  const [pendingOfflineCount, setPendingOfflineCount] = React.useState(0);
  const { identity } = useCompanyIdentity();
  const [sharingInvoice, setSharingInvoice] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  // "Factures du jour" - server-persisted DRAFT truck sales awaiting collection.
  const [pendingSales, setPendingSales] = React.useState<SaleDto[]>([]);
  const [preparing, setPreparing] = React.useState(false);
  const [collectTarget, setCollectTarget] = React.useState<SaleDto | null>(null);
  const [collectOpen, setCollectOpen] = React.useState(false);
  const [collecting, setCollecting] = React.useState(false);
  const flyToCart = useFlyToCart();

  // Phase 1 offline foundation: mirror every successful online context (the
  // initial server-rendered load, then every refreshContext()) into SQLite.
  // Cache-only - `context` state above (still fed straight from the server)
  // is what the POS actually renders; this never changes that. A failed or
  // unavailable local cache is caught internally and never surfaces here -
  // see lib/offline/driver-pos/database.ts's own doc comment.
  React.useEffect(() => {
    if (!currentUser?.organizationId) return;
    void hydrateDriverOfflineCache({
      organizationId: currentUser.organizationId,
      organizationName: identity?.tradeName ?? identity?.name ?? null,
      userId: currentUser.id,
      userName: currentUser.nom,
      context,
    });
  }, [context, currentUser, identity]);

  React.useEffect(() => {
    return () => {
      if (cartPulseTimeoutRef.current) clearTimeout(cartPulseTimeoutRef.current);
    };
  }, []);

  // Phase 3 - "15. COMPTEUR DE VENTES EN ATTENTE": (re)reads the SQLite
  // count on mount and whenever the driver identity changes, plus every time
  // an offline sale is created below (validateOfflineCashSale).
  const refreshPendingOfflineCount = React.useCallback(async () => {
    const organizationId = currentUser?.organizationId ?? null;
    if (!organizationId) return;
    const count = await countPendingOfflineSales({ organizationId, driverId: context.driver.id });
    setPendingOfflineCount(count);
  }, [currentUser, context.driver.id]);

  React.useEffect(() => {
    queueMicrotask(() => void refreshPendingOfflineCount());
  }, [refreshPendingOfflineCount]);

  // TEMPORARY dev diagnostic (Phase 3 bug hunt) - read once on mount, not
  // re-read on every render; the schema version doesn't change while the
  // app is running.
  React.useEffect(() => {
    queueMicrotask(() => {
      void getOfflineDbDiagnostic().then(setDbDiagnostic);
    });
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

  // Phase 2 data-source switch: tries the server first (and re-hydrates the
  // SQLite cache on success, same as before), falls back to the cache when
  // offline or when the server is unreachable despite `navigator.onLine`
  // (see lib/offline/driver-pos/pos-data-source.ts). Passing the current
  // selection keeps the same "a refresh must never silently drop who's
  // selected" guarantee the online-only version already had.
  async function refreshContext() {
    if (!currentUser?.organizationId) return;
    const result = await loadDriverPosContext({
      organizationId: currentUser.organizationId,
      organizationName: identity?.tradeName ?? identity?.name ?? null,
      userId: currentUser.id,
      userName: currentUser.nom,
      driverId: context.driver.id,
      customerId: selectedCustomer?.id ?? null,
    });

    if (!result.ok) {
      // "14. CACHE ABSENT" - no server AND nothing usable in SQLite either
      // (NOT_FOUND) or SQLite itself failed (ERROR). Either way, `context`
      // in memory is left completely untouched - see "7. NE JAMAIS EFFACER
      // UN CONTEXTE VALIDE".
      console.log("[OFFLINE CACHE] refreshContext: no usable context -", result.reason);
      setContextUnavailable(true);
      setCacheDiagnostic("unavailable");
      return;
    }

    if (result.source === "cache") {
      setCacheDiagnostic(result.cacheCounts);
      if (result.context.products.length === 0 && context.products.length > 0) {
        // "7. NE JAMAIS EFFACER UN CONTEXTE VALIDE", exact scenario: the
        // cache technically answered but with 0 products while the POS
        // already has real ones showing - a read glitch (or a device that
        // hasn't hydrated yet), never a legitimate reason to blank the
        // screen. Keep the last good `context`, just flag it as stale.
        console.log(
          "[OFFLINE CACHE] cache returned 0 products while",
          context.products.length,
          "were already shown - keeping current context",
        );
        setContextUnavailable(true);
        return;
      }
    } else {
      setCacheDiagnostic(null);
    }

    setContextUnavailable(false);
    setContext(result.context);
    setContextSource(result.source);
    setCacheSyncedAt(result.source === "cache" ? result.cacheSyncedAt : null);
  }

  // Whenever connectivity and the context's own source disagree, resync:
  // just went offline (context still "server") -> fall back to cache;
  // just came back online (context still "cache") -> refresh from the
  // server. Naturally idempotent - once refreshContext() reconciles
  // `contextSource`, this stops firing until the next real transition.
  React.useEffect(() => {
    const needsCacheFallback = networkState !== "ONLINE" && contextSource === "server";
    const needsServerRefresh = networkState === "ONLINE" && contextSource === "cache";
    if (!needsCacheFallback && !needsServerRefresh) return;
    // Deferred to a microtask so the effect body itself never synchronously
    // triggers refreshContext's own setContext/setContextSource calls.
    queueMicrotask(() => void refreshContext());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [networkState, contextSource]);

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

  // Phase 2: "9. VALIDATION / ENCAISSEMENT OFFLINE" - no silent server
  // attempt, no local sale, no touched cart. Checked at the moment of the
  // click (matches what NetworkStatusBadge is currently showing) rather
  // than trusting a stale closure - true offline sale creation is Phase 3.
  function blockIfOffline(): boolean {
    if (networkState === "ONLINE") return false;
    toast.error(OFFLINE_SALE_MESSAGE);
    return true;
  }

  // Phase 3 - "1. COMPORTEMENT ATTENDU" / "6. TRANSACTION SQLITE
  // OBLIGATOIRE": the offline-CASH branch of validateSale. Builds the exact
  // atomic write already implemented in sales-store.ts's createOfflineSale
  // (sale + lines + truck-stock decrement + outbox entry, one transaction),
  // using ONLY the driver's own validated/cached context - never a
  // UI-entered org/driver/truck/tour id (see "21. SÉCURITÉ"). On success the
  // cart is emptied and a "TICKET HORS CONNEXION" preview replaces `lastSale`
  // (never a real invoice - see "16. IMPRESSION OFFLINE" / "17. WHATSAPP
  // OFFLINE"); on failure the cart, stock and payment mode are left exactly
  // as the driver had them (see "11. EN CAS D'ÉCHEC SQLITE").
  async function validateOfflineCashSale() {
    if (cartRows.length === 0) return;
    const organizationId = currentUser?.organizationId ?? null;
    const driverId = context.driver.id;
    if (!organizationId || !driverId) {
      toast.error(OFFLINE_SAVE_ERROR_MESSAGE);
      return;
    }

    const handledCustomerId = selectedCustomer?.id ?? null;
    const soldAt = new Date().toISOString();

    const offlineSaleInput = {
      // Generated fresh here, as a plain local value - never a React
      // useRef (see "3. IDENTIFIANT LOCAL"), so a later retry after a
      // failed attempt always gets its own new key.
      clientMutationId: crypto.randomUUID(),
      organizationId,
      driverId,
      truckId: context.truck?.id ?? null,
      tourId: context.tour?.id ?? null,
      stockLocationId: context.stockLocationId ?? null,
      customerId: handledCustomerId,
      paymentMethod: "CASH" as const,
      soldAt,
      subtotalHT: totals.ht,
      taxAmount: totals.tax,
      totalTTC: totals.ttc,
      // CASH is always paid in full on the spot - never a credit line.
      paidAmount: totals.ttc,
      creditAmount: 0,
      lines: cartRows.map((row) => ({
        productId: row.productId,
        productNameSnapshot: row.product.name,
        quantity: row.quantity,
        unitPriceSnapshot: row.product.salePriceTTC,
        taxRateSnapshot: row.product.taxRate,
        discountSnapshot: 0,
        totalHT: row.totals.totalHT,
        taxAmount: row.totals.taxAmount,
        totalTTC: row.totals.totalTTC,
      })),
    };

    // BUG CRITIQUE PHASE 3 bug hunt - "3. VÉRIFIER LE PAYLOAD AVANT
    // INSERTION": SQLite must never see undefined/NaN in a NOT NULL column.
    // Logged in full (no secrets - this is only ids/amounts) so a failed
    // attempt's exact payload is visible on the device without ADB, then
    // validated BEFORE createOfflineSale is even called - a bad payload is
    // now caught here instead of surfacing as an opaque SQLite error.
    console.log("[OFFLINE SALE] payload", offlineSaleInput);
    const payloadIssue = findOfflineSalePayloadIssue(offlineSaleInput);
    if (payloadIssue) {
      console.error("[OFFLINE SALE] invalid payload - refusing to call createOfflineSale", {
        issue: payloadIssue,
        payload: offlineSaleInput,
      });
      toast.error(`Offline SQLite: ${payloadIssue}`);
      return;
    }

    setBusy(true);
    try {
      const result = await createOfflineSale(offlineSaleInput);

      if (!result.ok) {
        const message = describeOfflineSaleError(result.error);
        console.error("[OFFLINE SALE] creation failed", { message, error: result.error });
        // TEMPORARY (Phase 3 bug hunt) - shows the exact SQLite/plugin
        // failure reason so it can be read directly on a real device
        // without ADB. Revert to the plain OFFLINE_SAVE_ERROR_MESSAGE once
        // the root cause is confirmed fixed.
        toast.error(`Offline SQLite: ${message}`);
        return;
      }

      // Re-read from SQLite (rather than guessing) so the ticket's
      // "OFF-..." reference is exactly the one getOfflineSales/driver-sales-
      // view.tsx will show later - both derive it the same way, from the
      // same table.
      const offlineSales = await getOfflineSales({ organizationId, driverId });
      const localReference =
        offlineSales.find((sale) => sale.localId === result.localId)?.localReference ??
        result.localId;

      const ticket = buildPreviewSale({
        displayNumber: localReference,
        createdByUserName: context.driver.name,
        customer: selectedCustomer
          ? { id: selectedCustomer.id, code: selectedCustomer.code, name: selectedCustomer.name }
          : null,
        driver: { id: context.driver.id, name: context.driver.name },
        truck: context.truck
          ? { id: context.truck.id, code: context.truck.code, registration: context.truck.registration }
          : null,
        tour: context.tour
          ? { id: context.tour.id, code: context.tour.code, status: context.tour.status, date: "" }
          : null,
        paymentMethod: "CASH",
        bankAccount: null,
        lines: cartRows.map((row) => ({
          productId: row.productId,
          productReference: row.product.reference,
          productName: row.product.name,
          quantity: row.quantity,
          unitPriceHT: row.product.salePriceHT,
          discountUnitAmount: row.discountRate,
          taxRate: row.product.taxRate,
        })),
      });
      setLastSale({
        ...ticket,
        // Paid in cash on the spot, unlike buildPreviewSale's own DRAFT/
        // unpaid default (built for the still-unconfirmed cart preview) -
        // and never "DRAFT" so the footer never prints "EN ATTENTE DE
        // RÈGLEMENT" for a sale that already happened.
        status: "COMPLETED",
        paidAmount: ticket.totalTTC,
        creditAmount: 0,
        createdAt: soldAt,
      });
      setLastSalePhone(null);
      setOfflineTicketReference(localReference);
      resetForNextSale();
      if (handledCustomerId) {
        driverRuntime.markCustomerHandled(handledCustomerId);
      }
      toast.success(`Vente enregistrée hors connexion. Référence : ${localReference}`);
      await Promise.allSettled([refreshContext(), refreshPendingOfflineCount()]);
    } finally {
      setBusy(false);
    }
  }

  async function validateSale() {
    if (networkState !== "ONLINE") {
      if (paymentMethod !== "CASH") {
        toast.error(OFFLINE_PAYMENT_METHOD_MESSAGE);
        return;
      }
      await validateOfflineCashSale();
      return;
    }
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
      setOfflineTicketReference(null);
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
    if (blockIfOffline()) return;
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
      setOfflineTicketReference(null);
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
    if (blockIfOffline()) return;
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
      setOfflineTicketReference(null);
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
    setOfflineTicketReference(null);
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
    setOfflineTicketReference(null);
    window.setTimeout(() => window.print(), 0);
  }

  // Sharing is available only for an already-persisted, non-draft invoice;
  // the preview ticket never becomes a PDF attachment.
  const canShareWhatsApp = Boolean(
    lastSale && lastSale.id !== "preview" && lastSale.status !== "DRAFT" && lastSale.status !== "CANCELLED",
  );

  async function shareLastSaleOnWhatsApp() {
    if (!lastSale || !canShareWhatsApp) return;
    setSharingInvoice(true);
    try {
      const result = await shareInvoicePdf({
        sale: lastSale,
        identity,
        customerPhone: lastSalePhone,
      });
      if (result.method === "download") {
        toast.success("Facture PDF téléchargée. Joignez-la dans WhatsApp.");
      } else {
        toast.success("Facture PDF prête à être partagée.");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error(error instanceof Error ? error.message : "Impossible de générer la facture PDF.");
    } finally {
      setSharingInvoice(false);
    }
  }

  if (!context.canSell) {
    return <StateCard message={context.message ?? "La vente est impossible."} />;
  }

  // "14. CACHE ABSENT" - only when there is truly nothing to show (offline
  // AND no cache). Gated on `context.products.length === 0` too so a
  // perfectly good, already-loaded POS is never replaced by this message
  // just because a later background refresh attempt found no cache - see
  // refreshContext's own doc comment.
  if (contextUnavailable && context.products.length === 0) {
    return (
      <StateCard message="Les données hors connexion ne sont pas encore disponibles. Connectez-vous une première fois à Internet pour initialiser le POS." />
    );
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
        offlineTicket={Boolean(offlineTicketReference)}
        lastSale={lastSale}
        onPrintLastSale={printLastSale}
        cacheSyncedAt={contextSource === "cache" ? cacheSyncedAt : null}
        cacheDiagnostic={cacheDiagnostic}
        dbDiagnostic={dbDiagnostic}
        pendingOfflineCount={pendingOfflineCount}
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
                disabled={!canShareWhatsApp || sharingInvoice}
                onClick={() => void shareLastSaleOnWhatsApp()}
                className="h-12 w-full rounded-2xl border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
              >
                {sharingInvoice ? (
                  <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
                ) : (
                  <MessageCircle aria-hidden="true" className="h-4 w-4" />
                )}
                {sharingInvoice ? "Préparation du PDF..." : "WhatsApp"}
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
      <ReceiptPrint sale={lastSale} offlineReference={offlineTicketReference} />
    </div>
  );
}

function DriverInvoiceHeader({
  driverName,
  truckCode,
  truckRegistration,
  tourCode,
  invoiceLabel,
  offlineTicket,
  lastSale,
  onPrintLastSale,
  cacheSyncedAt,
  cacheDiagnostic,
  dbDiagnostic,
  pendingOfflineCount,
}: {
  driverName: string;
  truckCode: string;
  truckRegistration: string;
  tourCode: string | null;
  invoiceLabel: string;
  /** True while `invoiceLabel` is an "OFF-..." local reference, not a real
   *  invoice number - see this file's own "16. IMPRESSION OFFLINE". */
  offlineTicket: boolean;
  lastSale: SaleDto | null;
  onPrintLastSale: () => void;
  /** Set only while the POS is reading from the offline cache (see "11.
   *  ÉTAT DU CACHE") - the real offline_context.syncedAt, never a guess. */
  cacheSyncedAt?: string | null;
  /** TEMPORARY dev diagnostic - see driver-pos-view.tsx's own state comment. */
  cacheDiagnostic?: { products: number; customers: number; stock: number } | "unavailable" | null;
  /** TEMPORARY dev diagnostic (Phase 3 bug hunt) - see driver-pos-view.tsx's
   *  own state comment. */
  dbDiagnostic?: OfflineDbDiagnostic | null;
  /** Phase 3 - "15. COMPTEUR DE VENTES EN ATTENTE": count of local sales
   *  still PENDING_SYNC, read straight from SQLite. */
  pendingOfflineCount: number;
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
          The network badge always keeps this row non-empty now, on both
          mobile and desktop (Phase 1 offline foundation - display only, see
          components/driver-pos/network-status-badge.tsx). */}
      <div className="flex items-center gap-2">
        <Link
          href="/mobile"
          className="-ml-2 hidden h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent lg:inline-flex"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Point de vente
        </Link>
        <NetworkStatusBadge />
        {pendingOfflineCount > 0 ? (
          <Badge
            variant="outline"
            className="shrink-0 border-amber-200 bg-amber-50 text-amber-700"
          >
            {pendingOfflineCount} vente{pendingOfflineCount > 1 ? "s" : ""} en attente
          </Badge>
        ) : null}
        {cacheSyncedAt ? (
          <span className="truncate text-[11px] text-muted-foreground">
            Dernière synchro : {formatSyncTime(cacheSyncedAt)}
          </span>
        ) : null}
        {lastSale ? (
          <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={onPrintLastSale}>
            <Printer aria-hidden="true" className="h-4 w-4" />
            Imprimer
          </Button>
        ) : null}
      </div>

      {/* TEMPORARY dev diagnostic (Phase 2 bug hunt) - lets the offline
          cache be checked on a real device without DevTools. Remove once
          the offline read path is confirmed solid on Android. */}
      {cacheDiagnostic ? (
        <p className="text-[11px] text-muted-foreground">
          {cacheDiagnostic === "unavailable"
            ? "Cache indisponible"
            : `Cache : ${cacheDiagnostic.products} produits · ${cacheDiagnostic.customers} clients · ${cacheDiagnostic.stock} stocks`}
        </p>
      ) : null}

      {/* TEMPORARY dev diagnostic (Phase 3 bug hunt - "no such table:
          offline_sales") - lets the migrated schema be checked on a real
          device without DevTools. Remove once confirmed solid. */}
      {dbDiagnostic ? (
        <p className="text-[11px] text-muted-foreground">
          {`Offline DB v${dbDiagnostic.userVersion} : ${Object.entries(dbDiagnostic.tables)
            .map(([table, present]) => `${table} ${present ? "OK" : "MANQUANTE"}`)
            .join(" · ")}`}
        </p>
      ) : null}

      {/* Metadata strip: hidden on mobile (< xl) so the phone cart goes
          straight to Client / N° client / Paiement / panier. Screen display
          only - depot / stock-source stay in the sale payload and on the
          printed ticket; "Stock source" (which just repeated the truck code)
          was dropped from this strip. */}
      <div className="hidden rounded-2xl border border-border bg-muted/40 p-4 text-xs lg:grid lg:grid-cols-6 lg:gap-3">
        <HeaderMetric label={offlineTicket ? "Réf. locale" : "N° Facture"} value={invoiceLabel} strong />
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

/**
 * BUG CRITIQUE PHASE 3 bug hunt - "3. VÉRIFIER LE PAYLOAD AVANT INSERTION":
 * returns a short, human-readable description of the FIRST bad field found,
 * or null if the payload is clean. Every numeric column in offline_sales/
 * offline_sale_lines is NOT NULL, so a NaN/undefined here would otherwise
 * only ever surface later as an opaque SQLite error.
 */
function findOfflineSalePayloadIssue(input: {
  organizationId: string;
  driverId: string;
  soldAt: string;
  subtotalHT: number;
  taxAmount: number;
  totalTTC: number;
  paidAmount: number;
  creditAmount: number;
  lines: Array<{
    productId: string;
    productNameSnapshot: string;
    quantity: number;
    unitPriceSnapshot: number;
    taxRateSnapshot: number;
    discountSnapshot: number;
    totalHT: number;
    taxAmount: number;
    totalTTC: number;
  }>;
}): string | null {
  if (!input.organizationId) return "organizationId manquant";
  if (!input.driverId) return "driverId manquant";
  if (!input.soldAt) return "soldAt manquant";

  const numericFields: Array<[string, number]> = [
    ["subtotalHT", input.subtotalHT],
    ["taxAmount", input.taxAmount],
    ["totalTTC", input.totalTTC],
    ["paidAmount", input.paidAmount],
    ["creditAmount", input.creditAmount],
  ];
  for (const [name, value] of numericFields) {
    if (!Number.isFinite(value)) return `${name} invalide (${String(value)})`;
  }

  if (input.lines.length === 0) return "aucune ligne dans le panier";
  for (const line of input.lines) {
    if (!line.productId) return "productId manquant sur une ligne";
    if (!line.productNameSnapshot) return `productNameSnapshot manquant (${line.productId})`;
    const lineNumericFields: Array<[string, number]> = [
      ["quantity", line.quantity],
      ["unitPriceSnapshot", line.unitPriceSnapshot],
      ["taxRateSnapshot", line.taxRateSnapshot],
      ["discountSnapshot", line.discountSnapshot],
      ["totalHT", line.totalHT],
      ["taxAmount", line.taxAmount],
      ["totalTTC", line.totalTTC],
    ];
    for (const [name, value] of lineNumericFields) {
      if (!Number.isFinite(value)) return `ligne ${line.productId}: ${name} invalide (${String(value)})`;
    }
  }
  return null;
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

function formatSyncTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}
