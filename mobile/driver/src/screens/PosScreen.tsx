import * as React from "react";
import { AlertTriangle, ArrowLeft, CreditCard, LoaderCircle, MessageCircle, Printer, RefreshCw, ShoppingCart } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BankAccountCombobox } from "@/components/pos/bank-account-combobox";
import { CartSummary } from "@/components/pos/cart-summary";
import { CartTable } from "@/components/pos/cart-table";
import { MobileSelectedProduct } from "@/components/pos/mobile-selected-product";
import { MobileSupplierPicker } from "@/components/pos/mobile-supplier-picker";
import { ProductGrid } from "@/components/pos/product-grid";
import { ProductSearch } from "@/components/pos/product-search";
import { type SupplierOption } from "@/components/pos/supplier-filter";
import { useFlyToCart } from "@/components/pos/use-fly-to-cart";
import {
  createOfflineSale,
  describeOfflineSaleError,
  getOfflineCacheDiagnostics,
  getOfflineSales,
  syncPendingDriverSales,
  type DriverOfflineContext,
  type OfflineSaleWithLines,
} from "@/lib/offline/driver-pos";
import { roundMoney } from "@/lib/money";
import { buildPreviewSale } from "@/lib/pos-preview-sale";
import { shareInvoicePdf } from "@/lib/share-invoice";
import type { CustomerDto, DriverPosContextDto, DriverPosProductDto, SaleDto } from "@/types/operations-dto";
import { posPaymentMethods, type PosPaymentMethodValue } from "@/types/pos";
import type { PosProduct } from "@/types/pos";

import { ShellCustomerNumberInput } from "../components/shell-customer-number-input";
import { ShellCustomerPicker } from "../components/shell-customer-picker";
import { ShellNetworkBadge } from "../components/shell-network-badge";
import { ShellReceiptPrint } from "../components/shell-receipt-print";
import type { CartLineComputed, CartTotals } from "../lib/cart-types";
import { loadShellDriverPosContext, refreshFullDriverCustomerCache } from "../lib/driver-pos-data-source";
import { createOnlineDriverSale } from "../lib/driver-sales-api";
import { useOrganizationIdentity } from "../lib/organization-identity";
import { useShellPosProductSearch } from "../lib/use-shell-pos-product-search";
import { styles } from "../ui/styles";

type CartLine = { productId: string; quantity: number; discountRate: number };

/**
 * INTÉGRATION POS SHELL - orchestrator mirroring components/driver-pos/
 * driver-pos-view.tsx's core flow (products/cart/customer/payment/validate/
 * print/WhatsApp - see this phase's own "1. INTERFACE POS"), reusing every
 * portable sub-component UNCHANGED and every offline module UNCHANGED
 * (createOfflineSale, syncPendingDriverSales, getOfflineSales - same
 * functions the web app's driver-pos-view.tsx calls). driver-pos-view.tsx
 * itself is NOT imported: it depends on Next-only hooks (useAuth,
 * useCompanyIdentity, useNetworkState, useDriverRuntime) and bare relative
 * `fetch("/api/...")` calls tied to the web app's own cookie-authenticated
 * origin, none of which resolve correctly from this shell's cross-origin
 * Bearer context - see this file's own report for the exact list of what
 * was reused vs forked vs deliberately deferred (Factures du jour /
 * prepareInvoice-collectPending, GPS/tour tracking).
 */

const OFFLINE_PAYMENT_METHOD_MESSAGE = "Ce mode de reglement necessite une connexion Internet.";

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function round(value: number) {
  return roundMoney(value);
}

function computeLine(product: DriverPosProductDto, line: CartLine) {
  const grossHT = product.salePriceHT * line.quantity;
  const discountAmount = round(grossHT * (line.discountRate / 100));
  const totalHT = round(grossHT - discountAmount);
  const taxAmount = round(totalHT * (product.taxRate / 100));
  return { totalHT, taxAmount, totalTTC: round(totalHT + taxAmount) };
}

function findOfflineSalePayloadIssue(input: {
  organizationId: string;
  driverId: string;
  soldAt: string;
  subtotalHT: number;
  taxAmount: number;
  totalTTC: number;
  paidAmount: number;
  creditAmount: number;
  lines: Array<{ productId: string; productNameSnapshot: string; quantity: number; unitPriceSnapshot: number; taxRateSnapshot: number; discountSnapshot: number; totalHT: number; taxAmount: number; totalTTC: number }>;
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
  }
  return null;
}

function resolveInitialCustomer(context: DriverPosContextDto, initialCustomerId?: string | null): CustomerDto | null {
  if (!initialCustomerId) return null;
  return context.customers.find((customer) => customer.id === initialCustomerId) ?? null;
}

type PosScreenProps = {
  token: string | null;
  offlineContext: DriverOfflineContext;
  deviceOnline: boolean;
  onBack: () => void;
};

export function PosScreen({ token, offlineContext, deviceOnline, onBack }: PosScreenProps) {
  const [context, setContext] = React.useState<DriverPosContextDto | null>(null);
  // CORRECTION "CACHE COMPLET CLIENTS CHAUFFEUR" - starts as context.customers
  // (the small POS preload, or - after an offline restart - already the full
  // cached list, since refreshFullDriverCustomerCache overwrites
  // cached_customers in place) and is upgraded to the complete authorized
  // list once refreshFullDriverCustomerCache succeeds. Passed to the picker/
  // N° client input INSTEAD OF context.customers so both always search the
  // widest list currently available, online or offline.
  const [allCustomers, setAllCustomers] = React.useState<CustomerDto[]>([]);
  const [fullCustomersCached, setFullCustomersCached] = React.useState(false);
  const [contextSource, setContextSource] = React.useState<"server" | "cache" | null>(null);
  const [cacheSyncedAt, setCacheSyncedAt] = React.useState<string | null>(null);
  const [contextError, setContextError] = React.useState<"NOT_FOUND" | "ERROR" | null>(null);
  // "24. FAUX ONLINE" - corrected by actual attempt outcomes (mobileFetch's
  // ok/unauthorized/server_error all mean the server WAS reached; only a
  // network_error means it was not), never trusted from navigator.onLine
  // alone once a real attempt has happened.
  const [serverReachable, setServerReachable] = React.useState(deviceOnline);
  const effectiveOnline = deviceOnline && serverReachable;

  const [search, setSearch] = React.useState("");
  const [cart, setCart] = React.useState<CartLine[]>([]);
  const [lastAddedProductId, setLastAddedProductId] = React.useState<string | null>(null);
  const [mobileView, setMobileView] = React.useState<"products" | "cart">("cart");
  const cartSectionRef = React.useRef<HTMLDivElement>(null);
  const cartButtonRef = React.useRef<HTMLDivElement>(null);
  const [cartPulse, setCartPulse] = React.useState(false);
  const cartPulseTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedCustomer, setSelectedCustomer] = React.useState<CustomerDto | null>(null);
  const [paymentMethod, setPaymentMethod] = React.useState<PosPaymentMethodValue>("CASH");
  const [bankAccountId, setBankAccountId] = React.useState("");
  const [paidAmount, setPaidAmount] = React.useState("");
  const [lastSale, setLastSale] = React.useState<SaleDto | null>(null);
  const [offlineTicketReference, setOfflineTicketReference] = React.useState<string | null>(null);
  const [offlinePendingSales, setOfflinePendingSales] = React.useState<OfflineSaleWithLines[]>([]);
  const pendingOfflineCount = offlinePendingSales.length;
  const syncableOfflineCount = offlinePendingSales.filter(
    (sale) => sale.syncStatus === "PENDING_SYNC" || sale.syncStatus === "SYNC_ERROR",
  ).length;
  const [syncingSales, setSyncingSales] = React.useState(false);
  const [sharingInvoice, setSharingInvoice] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const flyToCart = useFlyToCart();
  const identity = useOrganizationIdentity(token);
  const idempotencyKeyRef = React.useRef<string>(crypto.randomUUID());

  // "24. FAUX ONLINE" - the one place `serverReachable` is corrected from a
  // real attempt's outcome. loadShellDriverPosContext only tried the server
  // at all when `token` was truthy - so `source === "cache"` with a token
  // present means that real attempt failed (network/auth/server error, all
  // folded into the cache fallback by the data source); with no token, no
  // attempt was made and reachability is simply left as whatever it already
  // was (device signal, or a prior real attempt).
  const applyContextResult = React.useCallback(
    (result: Awaited<ReturnType<typeof loadShellDriverPosContext>>) => {
      if (!result.ok) {
        setContextError(result.reason);
        return;
      }
      setContextError(null);
      setContext(result.context);
      setAllCustomers(result.context.customers);
      setContextSource(result.source);
      setCacheSyncedAt(result.source === "cache" ? result.cacheSyncedAt : null);
      if (result.source === "server") setServerReachable(true);
      else if (token) setServerReachable(false);
    },
    [token],
  );

  const loadContext = React.useCallback(
    async (customerId?: string | null) => {
      const result = await loadShellDriverPosContext({
        token,
        organizationId: offlineContext.organizationId,
        organizationName: offlineContext.organizationName,
        userId: offlineContext.userId,
        userName: offlineContext.userName,
        driverId: offlineContext.driverId,
        customerId: customerId ?? selectedCustomer?.id ?? null,
      });
      applyContextResult(result);
    },
    [token, offlineContext, selectedCustomer, applyContextResult],
  );

  React.useEffect(() => {
    let active = true;
    (async () => {
      const result = await loadShellDriverPosContext({
        token,
        organizationId: offlineContext.organizationId,
        organizationName: offlineContext.organizationName,
        userId: offlineContext.userId,
        userName: offlineContext.userName,
        driverId: offlineContext.driverId,
      });
      if (!active) return;
      applyContextResult(result);
      if (result.ok) setSelectedCustomer(resolveInitialCustomer(result.context, null));
      // "13. DONNÉES DE DIAGNOSTIC" - dev-only row counts, never shown in
      // production UI, to tell apart "the online→SQLite write never
      // happened" from "it happened for a different org/driver" from "it
      // happened correctly" on a real device via logcat.
      if (import.meta.env.DEV) {
        void getOfflineCacheDiagnostics({
          organizationId: offlineContext.organizationId,
          driverId: offlineContext.driverId,
        }).then((diagnostics) => {
          if (active) console.log("[OFFLINE CACHE DIAGNOSTICS]", diagnostics);
        });
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only, refreshContext handles later reloads
  }, []);

  // CORRECTION "CACHE COMPLET CLIENTS CHAUFFEUR" - "2./3./4.": GET
  // /api/driver/pos's context.customers is a small, bounded preload (20 max -
  // see getPosCustomerPreload). Once online, fetch the driver's COMPLETE
  // authorized customer list (GET /api/driver/customers, same org/driver
  // access rule, no limit) and overwrite cached_customers with it, so both
  // the online picker/N° client search and any later offline session search
  // the full set, not just the 20 most recent. Retries automatically on
  // every online transition until it succeeds once; a failed attempt (no
  // network, CORS, 401) never touches the existing cache - see
  // refreshFullDriverCustomerCache's own doc comment.
  React.useEffect(() => {
    if (!effectiveOnline || !token || fullCustomersCached) return;
    let cancelled = false;
    void refreshFullDriverCustomerCache({
      token,
      organizationId: offlineContext.organizationId,
      driverId: offlineContext.driverId,
    }).then((fullList) => {
      if (cancelled || !fullList) return;
      setAllCustomers(fullList);
      setFullCustomersCached(true);
      if (import.meta.env.DEV) console.log("[OFFLINE CACHE] full driver customers cached", fullList.length);
    });
    return () => {
      cancelled = true;
    };
  }, [effectiveOnline, token, fullCustomersCached, offlineContext.organizationId, offlineContext.driverId]);

  const refreshOfflinePendingSales = React.useCallback(async () => {
    const sales = await getOfflineSales({
      organizationId: offlineContext.organizationId,
      driverId: offlineContext.driverId,
    });
    setOfflinePendingSales(sales.filter((sale) => sale.syncStatus !== "SYNCED"));
  }, [offlineContext.organizationId, offlineContext.driverId]);

  React.useEffect(() => {
    queueMicrotask(() => void refreshOfflinePendingSales());
  }, [refreshOfflinePendingSales]);

  async function handleSyncPendingSales() {
    if (syncingSales || syncableOfflineCount === 0) return;
    setSyncingSales(true);
    try {
      const result = await syncPendingDriverSales({
        organizationId: offlineContext.organizationId,
        driverId: offlineContext.driverId,
      });
      await refreshOfflinePendingSales();
      if (result.stoppedForAuth) {
        toast.error("Session expiree. Reconnectez-vous pour synchroniser les ventes.");
      }
      if (result.synced.length === 1) {
        toast.success(`Vente synchronisee : ${result.synced[0].officialDisplayNumber}`);
      } else if (result.synced.length > 1) {
        toast.success(`${result.synced.length} ventes synchronisees`);
      }
      if (result.transientErrors.length > 0) {
        toast.error(`${result.transientErrors.length} vente(s) n'ont pas pu etre synchronisee(s). Reessayez plus tard.`);
      }
      if (result.requiresReview.length > 0) {
        toast.error(`${result.requiresReview.length} vente(s) hors connexion necessite(nt) une verification.`);
      }
      if (result.synced.length > 0) await loadContext();
    } finally {
      setSyncingSales(false);
    }
  }

  const { products: filteredProducts, allKnownProducts } = useShellPosProductSearch(
    token,
    context?.products ?? [],
    search,
    { truncated: context?.productsTruncated ?? false, locationId: context?.stockLocationId, normalize },
  );

  const productById = React.useMemo(() => new Map(allKnownProducts.map((product) => [product.id, product])), [allKnownProducts]);

  const [supplierFilter, setSupplierFilter] = React.useState<SupplierOption | null>(null);
  const supplierOptions = React.useMemo<SupplierOption[]>(() => {
    const byId = new Map<string, string>();
    for (const product of allKnownProducts) {
      if (product.supplierId && product.supplierName) byId.set(product.supplierId, product.supplierName);
    }
    return Array.from(byId, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "fr"));
  }, [allKnownProducts]);

  const supplierFilteredProducts = React.useMemo(
    () => (supplierFilter ? filteredProducts.filter((product) => product.supplierId === supplierFilter.id) : filteredProducts),
    [filteredProducts, supplierFilter],
  );

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
        .filter((line): line is CartLine & { product: DriverPosProductDto; totals: ReturnType<typeof computeLine> } => Boolean(line)),
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

  const cartLinesForTable = React.useMemo<CartLineComputed[]>(
    () =>
      cartRows.map((row) => ({
        productId: row.productId,
        designation: row.product.name,
        reference: row.product.reference,
        quantity: row.quantity,
        discountUnitAmount: 0,
        unitPriceHT: row.product.salePriceHT,
        unitPriceTTC: row.product.salePriceTTC,
        tauxTVA: row.product.taxRate,
        baseHT: row.product.salePriceHT * row.quantity,
        discountAmount: 0,
        netHT: row.totals.totalHT,
        tvaAmount: row.totals.taxAmount,
        totalTTC: row.totals.totalTTC,
        transferValue: 0,
      })),
    [cartRows],
  );

  const cartTotalsForSummary = React.useMemo<CartTotals>(
    () => ({ sousTotalHT: totals.ht, remise: 0, tva: totals.tax, totalTTC: totals.ttc, netAPayer: totals.ttc, transferValue: 0 }),
    [totals],
  );

  const mobileSelectedProduct = React.useMemo(() => {
    if (!lastAddedProductId) return null;
    const row = cartRows.find((line) => line.productId === lastAddedProductId);
    if (!row) return null;
    return { designation: row.product.name, quantity: row.quantity, priceTTC: row.product.salePriceTTC, imageUrl: row.product.imageUrl };
  }, [cartRows, lastAddedProductId]);

  function addProduct(product: DriverPosProductDto) {
    setCart((current) => {
      const existing = current.find((line) => line.productId === product.id);
      if (!existing) return [...current, { productId: product.id, quantity: 1, discountRate: 0 }];
      return current.map((line) => (line.productId === product.id ? { ...line, quantity: line.quantity + 1 } : line));
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
    flyToCart({ product, sourceElement, cartElement: cartButtonRef.current, onComplete: showMobileCartFeedback });
  }

  function openMobileCart() {
    setMobileView("cart");
    requestAnimationFrame(() => cartSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function updateQuantity(productId: string, quantity: number) {
    setCart((current) => current.map((line) => (line.productId === productId ? { ...line, quantity: Math.max(1, quantity) } : line)));
  }
  function incrementQuantity(productId: string) {
    setCart((current) => current.map((line) => (line.productId === productId ? { ...line, quantity: line.quantity + 1 } : line)));
  }
  function decrementQuantity(productId: string) {
    setCart((current) => {
      const line = current.find((item) => item.productId === productId);
      if (!line) return current;
      if (line.quantity <= 1) return current.filter((item) => item.productId !== productId);
      return current.map((item) => (item.productId === productId ? { ...item, quantity: item.quantity - 1 } : item));
    });
  }
  function removeProduct(productId: string) {
    setCart((current) => current.filter((line) => line.productId !== productId));
  }

  function resetForNextSale() {
    setCart([]);
    setLastAddedProductId(null);
    setPaidAmount("");
    setPaymentMethod("CASH");
    setBankAccountId("");
    idempotencyKeyRef.current = crypto.randomUUID();
  }

  async function validateOfflineCashSale() {
    if (cartRows.length === 0 || !context) return;
    const organizationId = offlineContext.organizationId;
    const driverId = offlineContext.driverId;
    const handledCustomerId = selectedCustomer?.id ?? null;
    const soldAt = new Date().toISOString();

    const offlineSaleInput = {
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
        priceToken: row.product.priceToken ?? null,
      })),
    };

    const payloadIssue = findOfflineSalePayloadIssue(offlineSaleInput);
    if (payloadIssue) {
      toast.error(`Offline SQLite: ${payloadIssue}`);
      return;
    }

    setBusy(true);
    try {
      const result = await createOfflineSale(offlineSaleInput);
      if (!result.ok) {
        toast.error(`Offline SQLite: ${describeOfflineSaleError(result.error)}`);
        return;
      }

      const offlineSales = await getOfflineSales({ organizationId, driverId });
      const localReference = offlineSales.find((sale) => sale.localId === result.localId)?.localReference ?? result.localId;

      const ticket = buildPreviewSale({
        displayNumber: localReference,
        createdByUserName: context.driver.name,
        customer: selectedCustomer ? { id: selectedCustomer.id, code: selectedCustomer.code, name: selectedCustomer.name } : null,
        driver: { id: context.driver.id, name: context.driver.name },
        truck: context.truck ? { id: context.truck.id, code: context.truck.code, registration: context.truck.registration } : null,
        tour: context.tour ? { id: context.tour.id, code: context.tour.code, status: context.tour.status, date: "" } : null,
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
      setLastSale({ ...ticket, status: "COMPLETED", paidAmount: ticket.totalTTC, creditAmount: 0, createdAt: soldAt });
      setOfflineTicketReference(localReference);
      resetForNextSale();
      toast.success(`Vente enregistree hors connexion. Reference : ${localReference}`);
      await Promise.allSettled([loadContext(), refreshOfflinePendingSales()]);
    } finally {
      setBusy(false);
    }
  }

  async function validateOnlineSale() {
    if (!token) {
      toast.error("Session expiree. Reconnectez-vous.");
      return;
    }
    if (paymentMethod === "BANK_TRANSFER" && !bankAccountId) {
      toast.error("Veuillez selectionner le compte bancaire qui a recu le virement.");
      return;
    }
    setBusy(true);
    try {
      const result = await createOnlineDriverSale(token, {
        customerId: selectedCustomer?.id ?? null,
        paymentMethod,
        paidAmount: paidAmount ? Number(paidAmount) : undefined,
        ...(paymentMethod === "BANK_TRANSFER" ? { bankAccountingAccountId: bankAccountId || null } : {}),
        lines: cart,
        idempotencyKey: idempotencyKeyRef.current,
      });
      if (!result.ok) {
        // A real network failure (not a business rejection) falls back to
        // the offline CASH path when possible - "23./24. PERTE RESEAU
        // PENDANT UNE VENTE" / "FAUX ONLINE": the cart is never dropped.
        setServerReachable(false);
        if (paymentMethod === "CASH") {
          toast.message("Connexion perdue - vente enregistree hors connexion a la place.");
          await validateOfflineCashSale();
          return;
        }
        toast.error(result.message);
        return;
      }
      setServerReachable(true);
      setLastSale(result.sale);
      setOfflineTicketReference(null);
      resetForNextSale();
      toast.success(`Vente ${result.sale.invoiceNumber} validee.`);
      await loadContext();
    } finally {
      setBusy(false);
    }
  }

  async function validateSale() {
    if (!effectiveOnline) {
      if (paymentMethod !== "CASH") {
        toast.error(OFFLINE_PAYMENT_METHOD_MESSAGE);
        return;
      }
      await validateOfflineCashSale();
      return;
    }
    await validateOnlineSale();
  }

  function printCurrentCart() {
    if (!context) return;
    if (cartRows.length === 0) {
      if (!lastSale) {
        toast.error("Aucune facture a imprimer.");
        return;
      }
      window.setTimeout(() => window.print(), 0);
      return;
    }
    setOfflineTicketReference(null);
    setLastSale(
      buildPreviewSale({
        displayNumber: lastSale?.displayNumber ?? "-",
        createdByUserName: context.driver.name,
        customer: selectedCustomer ? { id: selectedCustomer.id, code: selectedCustomer.code, name: selectedCustomer.name } : null,
        driver: { id: context.driver.id, name: context.driver.name },
        truck: context.truck ? { id: context.truck.id, code: context.truck.code, registration: context.truck.registration } : null,
        tour: context.tour ? { id: context.tour.id, code: context.tour.code, status: context.tour.status, date: "" } : null,
        paymentMethod,
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
      }),
    );
    window.setTimeout(() => window.print(), 0);
  }

  // "22. WHATSAPP OFFLINE" - a PENDING_SYNC sale's preview has id "preview"
  // (buildPreviewSale's own convention), so this is already false for it -
  // never a real invoice PDF until the sale is genuinely SYNCED.
  const canShareWhatsApp = Boolean(lastSale && lastSale.id !== "preview" && lastSale.status !== "DRAFT" && lastSale.status !== "CANCELLED");

  async function shareLastSaleOnWhatsApp() {
    if (!lastSale || !canShareWhatsApp) return;
    setSharingInvoice(true);
    try {
      const result = await shareInvoicePdf({ sale: lastSale, identity, customerPhone: selectedCustomer?.phone ?? null });
      toast.success(result.method === "download" ? "Facture PDF telechargee. Joignez-la dans WhatsApp." : "Facture PDF prete a etre partagee.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error(error instanceof Error ? error.message : "Impossible de generer la facture PDF.");
    } finally {
      setSharingInvoice(false);
    }
  }

  // "17. PREMIER LANCEMENT SANS CACHE" mirrored for the POS itself - never
  // an infinite spinner: once loadShellDriverPosContext reports ok:false (no
  // server AND no cache), this must win over the loading state below, not
  // the other way around, since `context` then never becomes non-null.
  if (contextError) {
    return (
      <main style={styles.page}>
        <BackHeader onBack={onBack} />
        <p style={styles.muted}>Donnees indisponibles. Connectez-vous une premiere fois a Internet.</p>
      </main>
    );
  }

  if (!context) {
    return (
      <main style={styles.page}>
        <BackHeader onBack={onBack} />
        <p style={styles.muted}>Chargement du point de vente...</p>
      </main>
    );
  }

  if (!context.canSell) {
    return (
      <main style={styles.page}>
        <BackHeader onBack={onBack} />
        <Card className="rounded-3xl">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <AlertTriangle className="h-10 w-10 text-muted-foreground/40" />
            <p className="max-w-md text-sm text-muted-foreground">{context.message ?? "La vente est impossible."}</p>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <div className="space-y-4 pb-6" style={{ minHeight: "100vh", background: "var(--background)" }}>
      <div ref={cartButtonRef} className="fixed top-[calc(env(safe-area-inset-top)+0.75rem)] z-40 lg:hidden" style={{ right: "max(0.75rem, env(safe-area-inset-right))" }}>
        <Button type="button" size="icon" aria-label={`Voir le panier, ${totals.quantity} article(s)`} onClick={openMobileCart} className="relative h-11 w-11 rounded-full shadow-lg">
          <ShoppingCart aria-hidden="true" className="h-5 w-5" />
          <span className={`absolute -top-1 -right-1 grid min-h-5 min-w-5 place-items-center rounded-full border-2 border-background bg-foreground px-1 text-[10px] font-bold text-background ${cartPulse ? "motion-safe:animate-bounce" : ""}`}>
            {totals.quantity}
          </span>
        </Button>
      </div>

      <section className="space-y-3 px-3 pt-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={onBack} className="-ml-2 inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent">
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Accueil
          </button>
          <ShellNetworkBadge online={effectiveOnline} />
          {pendingOfflineCount > 0 ? (
            <Badge variant="outline" className="shrink-0 border-amber-200 bg-amber-50 text-amber-700">
              {pendingOfflineCount} vente{pendingOfflineCount > 1 ? "s" : ""} en attente
            </Badge>
          ) : null}
          {effectiveOnline && syncableOfflineCount > 0 ? (
            <Button type="button" variant="outline" size="sm" disabled={syncingSales} onClick={() => void handleSyncPendingSales()} className="shrink-0 border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800">
              {syncingSales ? <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />}
              {syncingSales ? "Synchronisation..." : `Synchroniser ${syncableOfflineCount} vente(s)`}
            </Button>
          ) : null}
          {contextSource === "cache" && cacheSyncedAt ? (
            <span className="truncate text-[11px] text-muted-foreground">Derniere synchro : {formatSyncTime(cacheSyncedAt)}</span>
          ) : null}
          {lastSale ? (
            <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={printCurrentCart}>
              <Printer aria-hidden="true" className="h-4 w-4" />
              Imprimer
            </Button>
          ) : null}
        </div>
      </section>

      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-muted/60 p-1 mx-3" role="tablist" aria-label="Vues du point de vente chauffeur">
        <Button type="button" role="tab" aria-selected={mobileView === "products"} variant={mobileView === "products" ? "default" : "ghost"} onClick={() => setMobileView("products")} className="h-10 rounded-xl text-sm">
          Les produits
        </Button>
        <Button type="button" role="tab" aria-selected={mobileView === "cart"} variant={mobileView === "cart" ? "default" : "ghost"} onClick={() => setMobileView("cart")} className="h-10 rounded-xl text-sm">
          Panier ({totals.quantity})
        </Button>
      </div>

      {mobileView === "products" && <MobileSelectedProduct product={mobileSelectedProduct} />}

      <div className="px-3">
        {mobileView === "products" ? (
          <div className="flex min-w-0 flex-col gap-3">
            <ProductSearch value={search} onChange={setSearch} />
            <MobileSupplierPicker suppliers={supplierOptions} value={supplierFilter} onChange={setSupplierFilter} />
            <ProductGrid products={productTiles} onAdd={addProductById} onAdded={handleMobileProductAdded} />
          </div>
        ) : (
          <div id="mobile-driver-pos-cart" ref={cartSectionRef} className="space-y-4">
            <Card className="rounded-[24px] border-0 ring-0 shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
              <CardContent className="space-y-4 p-4">
                <div className="grid gap-3 grid-cols-[7fr_3fr] [&>*]:min-w-0 [&>*:last-child]:col-span-2">
                  <ShellCustomerPicker token={token} online={effectiveOnline} value={selectedCustomer} onChange={setSelectedCustomer} initialSuggestions={allCustomers} />
                  <ShellCustomerNumberInput token={token} online={effectiveOnline} customers={allCustomers} customer={selectedCustomer} onResolved={setSelectedCustomer} />

                  <div className="space-y-2">
                    <Label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <CreditCard aria-hidden="true" className="h-3.5 w-3.5" />
                      Mode de reglement
                    </Label>
                    <Select value={paymentMethod} onValueChange={(value) => value && setPaymentMethod(value as PosPaymentMethodValue)}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Selectionner">
                          {() => posPaymentMethods.find((method) => method.value === paymentMethod)?.label ?? "Selectionner"}
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
                    {!effectiveOnline && paymentMethod !== "CASH" ? (
                      <p className="text-xs text-destructive">{OFFLINE_PAYMENT_METHOD_MESSAGE}</p>
                    ) : null}
                  </div>

                  {paymentMethod === "BANK_TRANSFER" ? (
                    <div className="space-y-2">
                      <Label>Compte bancaire *</Label>
                      <BankAccountCombobox accounts={context.bankAccounts} accountId={bankAccountId} onChange={setBankAccountId} />
                      {context.bankAccounts.length === 0 ? <p className="text-xs text-muted-foreground">Aucun compte 5141 actif.</p> : null}
                    </div>
                  ) : null}

                  {paymentMethod === "MIXED" ? (
                    <div className="space-y-2">
                      <Label>Montant encaisse</Label>
                      <Input type="number" min={0} value={paidAmount} onChange={(event) => setPaidAmount(event.target.value)} className="h-10 rounded-2xl" />
                    </div>
                  ) : null}
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

                <Button type="button" size="lg" disabled={cartRows.length === 0 || busy} onClick={() => void validateSale()} className="h-14 w-full rounded-2xl text-base">
                  {busy ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
                  Valider
                </Button>

                <Button type="button" variant="outline" disabled={!canShareWhatsApp || sharingInvoice} onClick={() => void shareLastSaleOnWhatsApp()} className="h-12 w-full rounded-2xl border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800">
                  {sharingInvoice ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : <MessageCircle aria-hidden="true" className="h-4 w-4" />}
                  {sharingInvoice ? "Preparation du PDF..." : offlineTicketReference ? "WhatsApp (disponible apres synchronisation)" : "WhatsApp"}
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      <ShellReceiptPrint sale={lastSale} identity={identity} offlineReference={offlineTicketReference} />
    </div>
  );
}

function BackHeader({ onBack }: { onBack: () => void }) {
  return (
    <header style={styles.header}>
      <h1 style={styles.title}>Point de vente</h1>
      <button type="button" style={styles.secondaryButton} onClick={onBack}>
        Retour
      </button>
    </header>
  );
}

function formatSyncTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}
