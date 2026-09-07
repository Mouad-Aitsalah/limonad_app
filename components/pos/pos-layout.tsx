"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Pencil, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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

function pendingSaleNumber(sale: SaleDto): number | null {
  const match = /^BR-\d{8}-(\d+)$/.exec(sale.invoiceNumber);
  return match ? Number(match[1]) : null;
}

export function PosLayout({ initialContext }: PosLayoutProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editSaleId = searchParams.get("editSaleId");

  const [context, setContext] = React.useState(initialContext);
  const [search, setSearch] = React.useState("");
  const [cart, setCart] = React.useState<CartLine[]>([]);
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
  // This is a client-only slot until it gets products and is persisted as a DRAFT.
  const [currentSlotNumber, setCurrentSlotNumber] = React.useState(1);
  const [preparing, setPreparing] = React.useState(false);
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

      const unitPriceHT = frozen?.unitPriceHT ?? product!.prixVenteHT;
      const unitPriceTTC = frozen?.unitPriceTTC ?? product!.prixVenteTTC;
      const discountPercent = line.discountPercent;
      const tauxTVA = frozen?.tauxTVA ?? product!.tauxTVA;
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

  function nextSlotNumber(sales: SaleDto[] = pendingSales) {
    return Math.max(
      0,
      ...sales.map(pendingSaleNumber).filter((number): number is number => number !== null),
    ) + 1;
  }

  const currentInvoiceNumber = openPendingSale
    ? pendingSaleNumber(openPendingSale) ?? currentSlotNumber
    : currentSlotNumber;
  // The ordering / selection / navigation key stays the numeric `number`
  // (unchanged logic - see §3). Only the visible `label` becomes the real
  // commercial reference: sale.displayNumber ("16/2026"), computed once by
  // formatSaleDisplayNumber in mapSaleToDto - never rebuilt here.
  const invoiceTabs = React.useMemo(() => {
    const tabs: { sale: SaleDto | null; number: number; label: string }[] = pendingSales.map(
      (sale) => ({
        sale,
        number: pendingSaleNumber(sale) ?? 0,
        label: sale.displayNumber,
      }),
    );
    if (!openPendingSale) {
      tabs.push({ sale: null, number: currentSlotNumber, label: "Nouveau" });
    }
    return tabs.sort((a, b) => a.number - b.number);
  }, [currentSlotNumber, openPendingSale, pendingSales]);
  const activeTabIndex = invoiceTabs.findIndex((tab) => tab.number === currentInvoiceNumber);
  const activeInvoiceLabel =
    editSale?.displayNumber ??
    openPendingSale?.displayNumber ??
    invoiceTabs.find((tab) => tab.number === currentInvoiceNumber)?.label ??
    "Nouveau";

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

    // UX: reset the search so the grid returns to normal and the operator can
    // type the next product straight away, caret kept in the field.
    setSearch("");
    searchInputRef.current?.focus();
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

  function startNewInvoice(slotNumber = nextSlotNumber()) {
    setCheckoutOpen(false);
    setLastSale(null);
    setOpenPendingSale(null);
    setCurrentSlotNumber(slotNumber);
    resetOperation();
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

    // An unused provisional slot stays the same: no empty Sale and no gap.
    setCheckoutOpen(false);
    setLastSale(null);
    resetOperation();
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
      })),
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
        const sales = payload.sales ?? [];
        setPendingSales(sales);
        setCurrentSlotNumber((current) =>
          cart.length === 0 && !openPendingSale ? nextSlotNumber(sales) : current,
        );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

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
        startNewInvoice(Math.max(nextSlotNumber(), (pendingSaleNumber(sale) ?? 0) + 1));
      } else {
        setOpenPendingSale(sale);
        setCurrentSlotNumber(pendingSaleNumber(sale) ?? currentSlotNumber);
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
      startNewInvoice(nextSlotNumber(remainingSales));
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
        setCurrentSlotNumber(pendingSaleNumber(sale) ?? currentSlotNumber);
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
      setCurrentSlotNumber(pendingSaleNumber(sale) ?? currentSlotNumber);
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

  async function navigateToInvoice(sale: SaleDto | null, targetNumber: number) {
    if (sale?.id === openPendingSale?.id || (!sale && !openPendingSale)) return;
    if (!(await persistCurrentSlotBeforeNavigating())) return;
    if (sale) {
      openPendingInvoice(sale);
    } else {
      startNewInvoice(targetNumber);
    }
  }

  async function navigateByOffset(offset: number) {
    const currentIndex = invoiceTabs.findIndex((tab) => tab.number === currentInvoiceNumber);
    const target = invoiceTabs[currentIndex + offset];
    if (target) await navigateToInvoice(target.sale, target.number);
  }

  const paymentMethodLabel =
    posPaymentMethods.find((method) => method.value === paymentMethod)?.label ?? "";

  return (
    <div className="space-y-4">
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
            const active = tab.number === currentInvoiceNumber;
            return (
              <Button
                key={tab.sale?.id ?? `slot-${tab.number}`}
                type="button"
                size="sm"
                variant={active ? "default" : "outline"}
                aria-label={`Ouvrir la facture ${tab.label}`}
                className="h-8 shrink-0 px-2.5 font-semibold tabular-nums"
                disabled={preparing || submitting || collecting}
                onClick={() => void navigateToInvoice(tab.sale, tab.number)}
              >
                {tab.label}
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

      <div className="grid gap-4 lg:h-[calc(100vh-11rem)] lg:grid-cols-2 lg:gap-6">
      <div className="flex flex-col gap-4 lg:h-full lg:overflow-hidden">
        <ProductSearch value={search} onChange={setSearch} inputRef={searchInputRef} />
        <div className="lg:flex-1 lg:overflow-y-auto lg:pr-1">
        <ProductGrid
          products={filteredProducts}
          onAdd={
            openPendingSale && !editSale
              ? () => toast.info("Cette facture est déjà préparée.")
              : addToCart
          }
        />
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-4 shadow-[0_10px_30px_rgba(15,23,42,0.06)] lg:h-full lg:overflow-y-auto">
        <InvoiceHeader
          userName={context.user.name}
          depotName={context.depot.name}
          stockLocationName={context.stockLocation.name}
          invoiceLabel={activeInvoiceLabel}
        />

        <div className="grid gap-3 sm:grid-cols-[4fr_3fr_3fr]">
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
            onIncrement={incrementQuantity}
            onDecrement={decrementQuantity}
            onQuantityChange={updateQuantity}
            onDiscountChange={updateDiscount}
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
