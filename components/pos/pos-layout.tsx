"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Pencil, Plus, ShoppingCart, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
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
import { MobileSelectedProduct } from "@/components/pos/mobile-selected-product";
import { useFlyToCart } from "@/components/pos/use-fly-to-cart";
import { usePosProductSearch } from "@/components/pos/use-pos-product-search";
import { InvoiceHeader } from "@/components/pos/invoice-header";
import { CustomerCombobox } from "@/components/pos/customer-combobox";
import { CustomerNumberInput } from "@/components/pos/customer-number-input";
import {
  describeMixedPaymentError,
  PaymentSelector,
  type MixedPaymentAmounts,
} from "@/components/pos/payment-selector";
import { CartTable } from "@/components/pos/cart-table";
import { CartSummary } from "@/components/pos/cart-summary";
import { InvoiceActions } from "@/components/pos/invoice-actions";
import { CheckoutDialog } from "@/components/pos/checkout-dialog";
import { ReceiptPrint } from "@/components/pos/receipt-print";

export type CartLine = {
  productId: string;
  quantity: number;
  discountPercent: number;
  /**
   * Per-line manual unit price HT, INDEPENDENT of the catalogue. Undefined =
   * use the product's catalogue price (the initial source). When set it is
   * what gets persisted on the SaleLine and reused for print / history /
   * edit - the Product row is never touched.
   */
  priceOverrideHT?: number;
};

export type CartLineComputed = {
  productId: string;
  designation: string;
  reference: string;
  quantity: number;
  discountPercent: number;
  unitPriceHT: number;
  unitPriceTTC: number;
  /** True when unitPriceHT comes from a manual per-line override, not the catalogue. */
  priceOverridden?: boolean;
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

// Identity of the not-yet-persisted "new invoice" tab. Tab identity is never
// a parsed/derived number - a persisted tab is keyed by its sale id, this
// one by a fixed sentinel.
const NEW_SLOT_KEY = "__new__";

export function PosLayout({ initialContext }: PosLayoutProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editSaleId = searchParams.get("editSaleId");
  const { currentUser } = useAuth();
  // Manual per-line price editing in the cart is ADMIN ONLY (client + server).
  const canEditLinePrice = currentUser?.role === "admin";

  const [context, setContext] = React.useState(initialContext);
  const [search, setSearch] = React.useState("");
  const [cart, setCart] = React.useState<CartLine[]>([]);
  const [mobileView, setMobileView] = React.useState<"products" | "cart">("cart");
  const cartSectionRef = React.useRef<HTMLDivElement>(null);
  const cartButtonRef = React.useRef<HTMLDivElement>(null);
  const [cartPulse, setCartPulse] = React.useState(false);
  const cartPulseTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Phase 2 - admin edit of an existing counter sale (from /ventes). When
  // set, the POS is in MODIFICATION mode: the cart is seeded from the sale,
  // per-line prices/discounts are the sale's historical ones (see
  // editLineInfoById), the primary action PATCHes instead of creating, and
  // the commercial number never changes.
  const [editSale, setEditSale] = React.useState<SaleDto | null>(null);
  const [savingEdit, setSavingEdit] = React.useState(false);
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
  // Paiement mixte: espèces + chèque doivent couvrir exactement le total,
  // saisis côte à côte dès que ce mode est choisi (voir PaymentSelector).
  const [mixedAmounts, setMixedAmounts] = React.useState<MixedPaymentAmounts>({
    cash: 0,
    cheque: 0,
  });
  const [checkoutOpen, setCheckoutOpen] = React.useState(false);
  // Stable for one sale attempt (F5): kept identical across a network retry
  // of confirmOperation, only ever replaced in resetOperation() once a sale
  // has actually gone through and a new one starts. A ref (not state) so it
  // never triggers a re-render and is guaranteed synchronously current the
  // instant confirmOperation reads it.
  const idempotencyKeyRef = React.useRef<string>(crypto.randomUUID());
  // So a product added from a search result can clear the field and keep the
  // caret ready for the next product (UX only - the add itself is unchanged).
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [lastSale, setLastSale] = React.useState<SaleDto | null>(null);

  // Server-persisted DRAFT sales awaiting collection, shown as numbered tabs.
  const [pendingSales, setPendingSales] = React.useState<SaleDto[]>([]);
  const [openPendingSale, setOpenPendingSale] = React.useState<SaleDto | null>(null);
  // The real commercial number ("33/2026") reserved server-side for the
  // still-empty "new invoice" slot (POST /api/sales/reserve-number), shown
  // in the cart header before any product is added - so the header never
  // reads "Nouveau". createCounterSale consumes it (passed back in the sale
  // body) instead of reserving a fresh one. The ref mirror keeps it
  // synchronously readable inside buildSaleBody; the in-flight ref stops a
  // double reservation (StrictMode / racing callers).
  const [slotReservation, setSlotReservation] = React.useState<
    { saleNumber: number; saleYear: number } | null
  >(null);
  const slotReservationRef = React.useRef<{ saleNumber: number; saleYear: number } | null>(
    null,
  );
  const reservationInFlightRef = React.useRef(false);
  const [preparing, setPreparing] = React.useState(false);
  const [collecting, setCollecting] = React.useState(false);
  const flyToCart = useFlyToCart();

  React.useEffect(() => {
    return () => {
      if (cartPulseTimeoutRef.current) clearTimeout(cartPulseTimeoutRef.current);
    };
  }, []);

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

  // Edit mode: the frozen per-line economics of the sale being modified, so
  // a line keeps its historical unit price / VAT even if the catalog price
  // has changed since (or the product is no longer in the POS preload). A
  // product ADDED during the edit has no entry here and is priced normally.
  const editLineInfoById = React.useMemo(() => {
    const map = new Map<
      string,
      { designation: string; reference: string; unitPriceHT: number; unitPriceTTC: number; tauxTVA: number }
    >();
    if (!editSale) return map;
    for (const line of editSale.lines) {
      map.set(line.productId, {
        designation: line.productName,
        reference: line.productReference,
        unitPriceHT: line.unitPriceHT,
        unitPriceTTC: line.unitPriceHT * (1 + line.taxRate / 100),
        tauxTVA: line.taxRate,
      });
    }
    return map;
  }, [editSale]);

  const cartLines = React.useMemo<CartLineComputed[]>(() => {
    if (openPendingSale) {
      return openPendingSale.lines.map((line) => ({
        productId: line.productId,
        designation: line.productName,
        reference: line.productReference,
        quantity: line.quantity,
        discountPercent: line.discountRate,
        unitPriceHT: line.unitPriceHT,
        unitPriceTTC: line.quantity > 0 ? line.totalTTC / line.quantity : 0,
        priceOverridden: false,
        tauxTVA: line.taxRate,
        baseHT: line.unitPriceHT * line.quantity,
        discountAmount: line.discountAmount,
        netHT: line.totalHT,
        tvaAmount: line.taxAmount,
        totalTTC: line.totalTTC,
        transferValue: 0,
      }));
    }

    return cart.flatMap((line) => {
      const product = productById.get(line.productId);
      const frozen = editLineInfoById.get(line.productId);
      if (!product && !frozen) return [];

      const tauxTVA = frozen?.tauxTVA ?? product!.tauxTVA;
      // Catalogue price is the initial source; a per-line override (typed in
      // the cart, always stored HT) takes over without ever touching the
      // Product row.
      const catalogueHT = frozen?.unitPriceHT ?? product!.prixVenteHT;
      const priceOverridden = line.priceOverrideHT != null;
      const unitPriceHT = priceOverridden ? line.priceOverrideHT! : catalogueHT;
      const unitPriceTTC = roundCurrency(unitPriceHT * (1 + tauxTVA / 100));
      const discountPercent = line.discountPercent;
      const baseHT = unitPriceHT * line.quantity;
      const discountAmount = baseHT * (discountPercent / 100);
      const netHT = baseHT - discountAmount;
      const tvaAmount = netHT * (tauxTVA / 100);
      const totalTTC = netHT + tvaAmount;

      return {
        productId: line.productId,
        designation: product?.designation ?? frozen!.designation,
        reference: product?.reference ?? frozen!.reference,
        quantity: line.quantity,
        discountPercent,
        unitPriceHT,
        unitPriceTTC,
        priceOverridden,
        tauxTVA,
        baseHT,
        discountAmount,
        netHT,
        tvaAmount,
        totalTTC,
        transferValue: 0,
      };
    });
  }, [cart, openPendingSale, productById, editLineInfoById]);

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

  const mobileSelectedProduct = React.useMemo(() => {
    const line = cartLines[0];
    if (!line) return null;

    return {
      designation: line.designation,
      quantity: line.quantity,
      priceTTC: line.unitPriceTTC,
      imageUrl: productById.get(line.productId)?.imageUrl,
    };
  }, [cartLines, productById]);

  // POS invoice tabs. A tab button shows ONLY a position index (1, 2, 3…)
  // among the invoices currently open in this POS - it is a navigation
  // handle, never a commercial reference. The real "N/YYYY" number lives in
  // the cart header (activeInvoiceLabel), the ticket, /ventes and the
  // journal - never on a tab. Tab identity is the sale id (or NEW_SLOT_KEY
  // for the not-yet-persisted slot); pendingSales already arrives
  // creation-ordered from the server, so index order == creation order.
  const invoiceTabs = React.useMemo(() => {
    const tabs: { key: string; sale: SaleDto | null }[] = pendingSales.map((sale) => ({
      key: sale.id,
      sale,
    }));
    if (!openPendingSale && !editSale) {
      tabs.push({ key: NEW_SLOT_KEY, sale: null });
    }
    return tabs.map((tab, index) => ({ ...tab, position: index + 1 }));
  }, [editSale, openPendingSale, pendingSales]);
  const activeTabKey = openPendingSale ? openPendingSale.id : NEW_SLOT_KEY;
  const activeTabIndex = invoiceTabs.findIndex((tab) => tab.key === activeTabKey);
  // Cart-header "N° Facture": the real commercial reference in every mode.
  // For the empty slot it is the server-reserved number - never "Nouveau"
  // ("…" only for the sub-second window before the reservation lands).
  const activeInvoiceLabel =
    editSale?.displayNumber ??
    openPendingSale?.displayNumber ??
    (slotReservation
      ? `${slotReservation.saleNumber}/${slotReservation.saleYear}`
      : "…");

  // Negative stock is allowed: the cart quantity is never capped at the
  // product's on-hand stock. The only lower bound is 1.
  function addToCart(productId: string) {
    const product = productById.get(productId);
    if (!product) return false;

    const singleProductMobile = window.matchMedia("(max-width: 63.999rem)").matches;

    setCart((prev) => {
      const existing = prev.find((line) => line.productId === productId);
      if (singleProductMobile) {
        if (existing) {
          return [{ ...existing, quantity: existing.quantity + 1 }];
        }

        return [{ productId, quantity: 1, discountPercent: 0 }];
      }

      if (existing) {
        return prev.map((line) =>
          line.productId === productId
            ? { ...line, quantity: line.quantity + 1 }
            : line,
        );
      }
      return [...prev, { productId, quantity: 1, discountPercent: 0 }];
    });

    // Keep scanner/keyboard focus on desktop. On mobile, do not reopen the
    // keyboard or scroll away from the product the user just tapped.
    setSearch("");
    if (window.matchMedia("(min-width: 64rem)").matches) {
      searchInputRef.current?.focus();
    }
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

  // Manual per-line price. The operator types a TTC value; it is stored HT
  // (independent of the catalogue). An empty / non-finite value clears the
  // override and the line falls back to the catalogue price.
  function updatePrice(productId: string, unitPriceTTC: number | null) {
    setCart((prev) =>
      prev.map((line) => {
        if (line.productId !== productId) return line;
        const clear =
          unitPriceTTC == null || !Number.isFinite(unitPriceTTC) || unitPriceTTC < 0;
        if (clear) return { ...line, priceOverrideHT: undefined };
        const taxRate =
          productById.get(productId)?.tauxTVA ??
          editLineInfoById.get(productId)?.tauxTVA ??
          0;
        return {
          ...line,
          priceOverrideHT: roundCurrency(unitPriceTTC / (1 + taxRate / 100)),
        };
      }),
    );
  }

  function removeFromCart(productId: string) {
    setCart((prev) => prev.filter((line) => line.productId !== productId));
  }

  // Reserves (once) the real commercial number for the current empty slot so
  // the cart header shows "33/2026" straight away. Reuses the held
  // reservation if it has not been consumed yet - navigating between tabs
  // never burns a number; only a sale actually being created does (see
  // clearSlotReservation, called on the create paths). No-op in edit mode.
  async function ensureSlotReservation() {
    if (editSaleId) return null;
    if (slotReservationRef.current) return slotReservationRef.current;
    if (reservationInFlightRef.current) return null;
    reservationInFlightRef.current = true;
    try {
      const response = await fetch("/api/sales/reserve-number", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(
          payload.message ?? "Impossible de réserver le numéro de facture.",
        );
      }
      const reservation = {
        saleNumber: payload.reservation.saleNumber as number,
        saleYear: payload.reservation.saleYear as number,
      };
      slotReservationRef.current = reservation;
      setSlotReservation(reservation);
      return reservation;
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Impossible de réserver le numéro de facture.",
      );
      return null;
    } finally {
      reservationInFlightRef.current = false;
    }
  }

  // A sale has taken the held reservation: drop it so the next empty slot
  // reserves a fresh number.
  function clearSlotReservation() {
    slotReservationRef.current = null;
    setSlotReservation(null);
  }

  // Resets everything tied to the invoice currently being typed: cart,
  // customer (back to the default), payment method, and the idempotency key
  // (a fresh sale attempt starts here). It never touches a persisted DRAFT.
  function resetOperation() {
    setCart([]);
    setSelectedCustomer(resolveDefaultCustomer(context.customers));
    setPaymentMethod(defaultPaymentMethod);
    setChequeNumber("");
    setBanque("");
    setDateEcheance("");
    setMixedAmounts({ cash: 0, cheque: 0 });
    idempotencyKeyRef.current = crypto.randomUUID();
  }

  function startNewInvoice() {
    setCheckoutOpen(false);
    setLastSale(null);
    setOpenPendingSale(null);
    resetOperation();
    void ensureSlotReservation();
  }

  // "+ Nouvelle facture" never discards products: an unprepared cart is
  // first persisted as a DRAFT, while an already-open DRAFT is simply closed.
  async function newInvoice() {
    if (openPendingSale) {
      startNewInvoice();
      return;
    }

    if (cartLines.length > 0) {
      setCheckoutOpen(false);
      await prepareInvoice(true);
      return;
    }

    // An unused provisional slot stays the same: no empty Sale and no gap,
    // and it keeps the commercial number it already reserved.
    setCheckoutOpen(false);
    setLastSale(null);
    resetOperation();
    void ensureSlotReservation();
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
      ...(paymentMethod === "MIXED"
        ? { cashAmount: mixedAmounts.cash, chequeAmount: mixedAmounts.cheque }
        : {}),
      lines: cartLines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        discountRate: line.discountPercent,
        // Only sent when the operator set a manual price - otherwise the
        // server keeps using the catalogue price.
        ...(line.priceOverridden ? { unitPriceHT: line.unitPriceHT } : {}),
      })),
      // The commercial number the "new invoice" tab already displayed -
      // reused verbatim by createCounterSale so the persisted sale carries
      // exactly that "N/YYYY" (guarded server-side).
      ...(slotReservationRef.current
        ? {
            reservedSaleNumber: slotReservationRef.current.saleNumber,
            reservedSaleYear: slotReservationRef.current.saleYear,
          }
        : {}),
      idempotencyKey: idempotencyKeyRef.current,
      ...extra,
    });
  }

  async function saveEdit() {
    if (!editSale) return;
    if (cartLines.length === 0) {
      toast.error("La facture doit contenir au moins un produit.");
      return;
    }
    if (paymentMethod !== "CASH" && !selectedCustomer) {
      toast.error("Sélectionnez un client.");
      return;
    }
    setSavingEdit(true);
    try {
      const response = await fetch(`/api/sales/${editSale.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: selectedCustomer?.id ?? null,
          paymentMethod,
          reference:
            paymentMethod === "CHECK"
              ? chequeNumber || null
              : paymentMethod === "BANK_TRANSFER"
                ? banque || null
                : null,
          ...(paymentMethod === "MIXED"
            ? { cashAmount: mixedAmounts.cash, chequeAmount: mixedAmounts.cheque }
            : {}),
          lines: cartLines.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            discountRate: line.discountPercent,
            ...(line.priceOverridden ? { unitPriceHT: line.unitPriceHT } : {}),
          })),
          expectedUpdatedAt: editSale.updatedAt ?? null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message ?? "Impossible d'enregistrer les modifications.");
      }
      setEditSale(null);
      toast.success(
        `Facture ${payload.sale.displayNumber ?? payload.sale.invoiceNumber} modifiée.`,
      );
      router.push("/ventes");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Impossible d'enregistrer les modifications.",
      );
    } finally {
      setSavingEdit(false);
    }
  }

  function leaveEditMode() {
    setEditSale(null);
    router.push("/ventes");
  }

  async function refreshPending() {
    try {
      const response = await fetch("/api/sales/pending", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { sales?: SaleDto[] };
      const sales = payload.sales ?? [];
      setPendingSales(sales);
      setOpenPendingSale((current) =>
        current ? sales.find((sale) => sale.id === current.id) ?? null : null,
      );
      return sales;
    } catch {
      // non-fatal: the panel just stays as it was
    }
  }

  React.useEffect(() => {
    let active = true;
    fetch("/api/sales/pending", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { sales: [] }))
      .then((payload: { sales?: SaleDto[] }) => {
        if (!active) return;
        setPendingSales(payload.sales ?? []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // The first empty slot gets its commercial number immediately, so the cart
  // header never shows "Nouveau". No-op in edit mode. The reservation state
  // is only ever set AFTER an awaited network round trip (never synchronously
  // in this effect body), so it cannot cascade renders.
  React.useEffect(() => {
    if (editSaleId) return;
    const timer = window.setTimeout(() => void ensureSlotReservation(), 0);
    return () => window.clearTimeout(timer);
    // ensureSlotReservation is a stable in-component function; it only reads
    // refs and editSaleId (checked above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editSaleId]);

  // Edit mode: load the sale referenced by ?editSaleId and seed the POS from
  // it (client, lines with historical prices/discounts, payment method).
  React.useEffect(() => {
    // editSaleId only ever goes value -> (unmount) here: leaveEditMode /
    // saveEdit both navigate away, so there is no value -> null transition to
    // clean up while mounted.
    if (!editSaleId) return;
    let cancelled = false;
    fetch(`/api/sales/${editSaleId}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message ?? "Facture introuvable.");
        return payload.sale as SaleDto;
      })
      .then((sale) => {
        if (cancelled) return;
        setEditSale(sale);
        setOpenPendingSale(null);
        setLastSale(null);
        setCart(
          sale.lines.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            discountPercent: line.discountRate,
          })),
        );
        const resolvedCustomer = sale.customer
          ? context.customers.find((item) => item.id === sale.customer?.id) ??
            (sale.customer as unknown as CustomerDto)
          : null;
        setSelectedCustomer(resolvedCustomer);
        setPaymentMethod(sale.paymentMethod as PosPaymentMethodValue);
        if (sale.paymentMethod === "MIXED") {
          const cash = sale.payments
            .filter((p) => p.method === "CASH")
            .reduce((sum, p) => sum + p.amount, 0);
          const cheque = sale.payments
            .filter((p) => p.method === "CHECK")
            .reduce((sum, p) => sum + p.amount, 0);
          setMixedAmounts({ cash, cheque });
        }
      })
      .catch((error) => {
        if (cancelled) return;
        toast.error(error instanceof Error ? error.message : "Impossible de charger la facture.");
        router.push("/ventes");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editSaleId]);

  // §25 - warn before leaving the POS with unsaved edits.
  React.useEffect(() => {
    if (!editSale) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [editSale]);

  async function syncPendingSalesState() {
    try {
      await Promise.all([refreshContext(), refreshPending()]);
    } catch {
      toast.error("Facture enregistree, mais impossible de rafraichir le POS.");
    }
  }

  async function createDraftSale() {
    const response = await fetch("/api/sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: buildSaleBody({ collectNow: false }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message ?? "Impossible de preparer la facture.");
    }

    const sale = payload.sale as SaleDto;
    // This draft took the slot's reserved number; the next empty slot must
    // get a fresh one.
    clearSlotReservation();
    setLastSale(sale);
    return sale;
  }

  function schedulePrint() {
    window.setTimeout(() => window.print(), 0);
  }

  async function confirmOperation(paidAmount?: number) {
    if (openPendingSale) {
      await collectOpenPendingSale(paidAmount);
      return;
    }
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
      toast.success(`Vente ${payload.sale.displayNumber} enregistrée.`);
      setCheckoutOpen(false);
      // That sale consumed the slot's reserved number - start the next slot
      // on a fresh one.
      clearSlotReservation();
      resetOperation();
      await refreshContext();
      void ensureSlotReservation();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Impossible d'enregistrer la vente.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  // Persists the active slot. Both preparation actions then move to a fresh slot.
  async function prepareInvoice(startAnotherInvoice = true) {
    if (!selectedCustomer) {
      toast.error("Sélectionnez un client avant de préparer la facture.");
      return;
    }
    setPreparing(true);
    try {
      const sale = await createDraftSale();
      toast.success(
        `Facture ${sale.displayNumber} préparée. Ajoutée aux factures en attente.`,
      );
      await syncPendingSalesState();
      if (startAnotherInvoice) {
        startNewInvoice();
      } else {
        setOpenPendingSale(sale);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Impossible de préparer la facture.",
      );
    } finally {
      setPreparing(false);
    }
  }

  async function collectOpenPendingSale(paidAmount?: number) {
    if (!openPendingSale) return;
    setCollecting(true);
    try {
      const response = await fetch(`/api/sales/${openPendingSale.id}/collect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentMethod,
          paidAmount,
          reference:
            paymentMethod === "CHECK"
              ? chequeNumber || null
              : paymentMethod === "BANK_TRANSFER"
                ? banque || null
                : null,
          ...(paymentMethod === "MIXED"
            ? { cashAmount: mixedAmounts.cash, chequeAmount: mixedAmounts.cheque }
            : {}),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message ?? "Impossible d'encaisser la facture.");
      }
      setLastSale(payload.sale as SaleDto);
      toast.success(`Facture ${payload.sale.displayNumber} encaissée.`);
      const remainingSales = pendingSales.filter((sale) => sale.id !== openPendingSale.id);
      setPendingSales(remainingSales);
      startNewInvoice();
      await Promise.all([refreshContext(), refreshPending()]);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Impossible d'encaisser la facture.",
      );
    } finally {
      setCollecting(false);
    }
  }

  async function printInvoice() {
    if (openPendingSale) {
      printPending(openPendingSale);
      return;
    }
    if (cartLines.length > 0) {
      if (!selectedCustomer) {
        toast.error("Selectionnez un client avant d'imprimer la facture.");
        return;
      }

      setPreparing(true);
      try {
        const sale = await createDraftSale();
        setOpenPendingSale(sale);
        await syncPendingSalesState();
        toast.success(`Facture ${sale.displayNumber} preparee. Impression lancee.`);
        schedulePrint();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Impossible d'imprimer la facture.",
        );
      } finally {
        setPreparing(false);
      }
      return;
    }

    printLastSale();
  }

  function printLastSale() {
    if (!lastSale) {
      toast.error("Aucune facture à imprimer.");
      return;
    }

    schedulePrint();
  }

  function printPending(sale: SaleDto) {
    setLastSale(sale);
    schedulePrint();
  }

  async function persistCurrentSlotBeforeNavigating() {
    if (openPendingSale || cartLines.length === 0) return true;
    if (!selectedCustomer) {
      toast.error("Sélectionnez un client avant de préparer la facture.");
      return false;
    }

    setPreparing(true);
    try {
      const sale = await createDraftSale();
      setOpenPendingSale(sale);
      await syncPendingSalesState();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible de préparer la facture.");
      return false;
    } finally {
      setPreparing(false);
    }
  }

  function openPendingInvoice(sale: SaleDto) {

    const customer = sale.customer
      ? context.customers.find((item) => item.id === sale.customer?.id) ?? (sale.customer as CustomerDto)
      : resolveDefaultCustomer(context.customers);
    setCheckoutOpen(false);
    setSelectedCustomer(customer);
    setPaymentMethod(defaultPaymentMethod);
    setChequeNumber("");
    setBanque("");
    setDateEcheance("");
    setMixedAmounts({ cash: 0, cheque: 0 });
    setCart([]);
    setOpenPendingSale(sale);
    setLastSale(sale);
  }

  async function navigateToInvoice(sale: SaleDto | null) {
    if (sale?.id === openPendingSale?.id || (!sale && !openPendingSale)) return;
    if (!(await persistCurrentSlotBeforeNavigating())) return;
    if (sale) {
      openPendingInvoice(sale);
    } else {
      startNewInvoice();
    }
  }

  async function navigateByOffset(offset: number) {
    const target = invoiceTabs[activeTabIndex + offset];
    if (target) await navigateToInvoice(target.sale);
  }

  const paymentMethodLabel =
    posPaymentMethods.find((method) => method.value === paymentMethod)?.label ?? "";
  const cartItemCount = cart.reduce((count, line) => count + line.quantity, 0);

  return (
    <div className="space-y-4">
      <div
        ref={cartButtonRef}
        className="fixed top-[calc(env(safe-area-inset-top)+0.75rem)] z-40 lg:hidden"
        style={{ right: "max(0.75rem, env(safe-area-inset-right))" }}
      >
        <Button
          type="button"
          size="icon"
          aria-label={`Voir le panier, ${cartItemCount} article${cartItemCount > 1 ? "s" : ""}`}
          onClick={openMobileCart}
          className="relative h-11 w-11 rounded-full shadow-lg"
        >
          <ShoppingCart aria-hidden="true" className="h-5 w-5" />
          <span
            className={`absolute -top-1 -right-1 grid min-h-5 min-w-5 place-items-center rounded-full border-2 border-background bg-foreground px-1 text-[10px] font-bold text-background ${cartPulse ? "motion-safe:animate-bounce" : ""}`}
          >
            {cartItemCount}
          </span>
        </Button>
      </div>

      {editSale ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3">
          <div className="flex items-center gap-2 text-amber-900">
            <Pencil aria-hidden="true" className="h-4 w-4" />
            <span className="font-semibold">
              Modification de la facture{" "}
              {editSale.displayNumber ?? editSale.invoiceNumber}
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={savingEdit}
            onClick={leaveEditMode}
          >
            <X aria-hidden="true" className="h-4 w-4" />
            Annuler la modification
          </Button>
        </div>
      ) : (
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={preparing || submitting || collecting}
          onClick={() => void newInvoice()}
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Nouvelle facture
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label="Facture précédente"
          disabled={activeTabIndex <= 0 || preparing || submitting || collecting}
          onClick={() => void navigateByOffset(-1)}
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        </Button>
        <div className="flex max-w-full flex-1 items-center gap-2 overflow-x-auto pb-1">
          {invoiceTabs.map((tab) => {
            const active = tab.key === activeTabKey;
            return (
              <Button
                key={tab.key}
                type="button"
                size="sm"
                variant={active ? "default" : "outline"}
                aria-label={`Onglet facture ${tab.position}`}
                aria-current={active ? "true" : undefined}
                className="h-8 w-8 shrink-0 p-0 font-semibold tabular-nums"
                disabled={preparing || submitting || collecting}
                onClick={() => void navigateToInvoice(tab.sale)}
              >
                {tab.position}
              </Button>
            );
          })}
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label="Facture suivante"
          disabled={
            activeTabIndex < 0 ||
            activeTabIndex >= invoiceTabs.length - 1 ||
            preparing ||
            submitting ||
            collecting
          }
          onClick={() => void navigateByOffset(1)}
        >
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </Button>
      </div>
      )}

      <div
        className="grid grid-cols-2 gap-1 rounded-2xl bg-muted/60 p-1 lg:hidden"
        role="tablist"
        aria-label="Vues du point de vente"
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
          Panier ({cartItemCount})
        </Button>
      </div>

      {mobileView === "products" && (
        <MobileSelectedProduct product={mobileSelectedProduct} className="lg:hidden" />
      )}
      <div className="grid gap-4 lg:h-[calc(100vh-11rem)] lg:grid-cols-2 lg:gap-6">
      <div
        className={`${mobileView === "products" ? "flex" : "hidden"} order-2 min-w-0 flex-col gap-3 lg:order-1 lg:flex lg:h-full lg:gap-4 lg:overflow-hidden`}
      >
        <ProductSearch value={search} onChange={setSearch} inputRef={searchInputRef} />
        <div className="lg:flex-1 lg:overflow-y-auto lg:pr-1">
        <ProductGrid
          products={filteredProducts}
          onAdd={
            openPendingSale && !editSale
              ? () => {
                  toast.info("Cette facture est déjà préparée.");
                  return false;
                }
              : addToCart
          }
          onAdded={openPendingSale && !editSale ? undefined : handleMobileProductAdded}
        />
        </div>
      </div>

      <div
        id="mobile-pos-cart"
        ref={cartSectionRef}
        className={`${mobileView === "cart" ? "flex" : "hidden"} order-1 min-w-0 scroll-mt-16 flex-col gap-3 rounded-3xl border border-border bg-card p-3 shadow-[0_10px_30px_rgba(15,23,42,0.06)] lg:order-2 lg:flex lg:h-full lg:gap-4 lg:overflow-y-auto lg:p-4`}
      >
        <InvoiceHeader
          userName={context.user.name}
          depotName={context.depot.name}
          stockLocationName={context.stockLocation.name}
          invoiceLabel={activeInvoiceLabel}
        />

        <div className="grid gap-3 max-lg:grid-cols-2 max-lg:[&>div]:min-w-0 max-lg:[&>div:last-child]:col-span-2 sm:grid-cols-[4fr_3fr_3fr]">
          <CustomerCombobox
            value={selectedCustomer}
            onChange={setSelectedCustomer}
            initialSuggestions={context.customers}
          />
          <CustomerNumberInput onResolved={setSelectedCustomer} />
          <PaymentSelector
            paymentMethod={paymentMethod}
            onPaymentMethodChange={setPaymentMethod}
            chequeNumber={chequeNumber}
            onChequeNumberChange={setChequeNumber}
            banque={banque}
            onBanqueChange={setBanque}
            dateEcheance={dateEcheance}
            onDateEcheanceChange={setDateEcheance}
            mixedAmounts={mixedAmounts}
            onMixedAmountsChange={setMixedAmounts}
            mixedTotal={totals.netAPayer}
          />
        </div>

        <div className="rounded-2xl border border-border">
          <CartTable
            lines={cartLines}
            operationType={operationType}
            readOnly={Boolean(openPendingSale) && !editSale}
            canEditPrice={canEditLinePrice}
            onIncrement={incrementQuantity}
            onDecrement={decrementQuantity}
            onQuantityChange={updateQuantity}
            onDiscountChange={updateDiscount}
            onPriceChange={updatePrice}
            onRemove={removeFromCart}
          />
        </div>

        <CartSummary totals={totals} operationType={operationType} />

        {editSale ? (
          <div className="space-y-2">
            <Button
              type="button"
              size="lg"
              className="h-12 w-full text-base"
              disabled={cartLines.length === 0 || savingEdit}
              onClick={() => void saveEdit()}
            >
              <Pencil aria-hidden="true" className="h-4 w-4" />
              {savingEdit ? "Enregistrement…" : "Enregistrer les modifications"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              disabled={savingEdit}
              onClick={leaveEditMode}
            >
              Annuler la modification
            </Button>
          </div>
        ) : (
        <InvoiceActions
          operationType={operationType}
          disabled={cartLines.length === 0}
          loading={submitting || collecting}
          onCheckout={() => {
            if (paymentMethod === "MIXED") {
              const mixedError = describeMixedPaymentError(mixedAmounts, totals.netAPayer);
              if (mixedError) {
                toast.error(mixedError);
                return;
              }
              const paid =
                Math.round((mixedAmounts.cash + mixedAmounts.cheque) * 100) / 100;
              const remaining =
                Math.round((totals.netAPayer - paid) * 100) / 100;
              if (remaining > 0 && !selectedCustomer) {
                toast.error(
                  "Veuillez sélectionner un client pour enregistrer le reste à crédit.",
                );
                return;
              }
            }
            setCheckoutOpen(true);
          }}
          onPrint={() => {
            void printInvoice();
          }}
          onHold={openPendingSale ? undefined : prepareInvoice}
          holdLoading={preparing}
        />
        )}

        <div className="rounded-2xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">État du POS</p>
          <p>
            Produits disponibles : {context.products.length} | Dépôt : {context.depot.code}
          </p>
          {context.message && <p className="mt-1 text-amber-700">{context.message}</p>}
          {lastSale && (
            <p className="mt-1">
              Dernière vente : {lastSale.displayNumber} · {lastSale.customer?.name ?? "Client"} ·{" "}
              {lastSale.totalTTC.toFixed(2)} MAD
            </p>
          )}
          {openPendingSale && (
            <p className="mt-1 font-medium text-amber-700">
              Facture ouverte : {openPendingSale.displayNumber} · En attente de règlement
            </p>
          )}
        </div>
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
        submitting={submitting || collecting}
        mixedAmounts={mixedAmounts}
        onConfirm={confirmOperation}
      />
      <ReceiptPrint sale={lastSale} />
    </div>
  );
}
