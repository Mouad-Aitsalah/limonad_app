"use client";

import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Package2,
  Printer,
  ShoppingCart,
  Trash2,
  Truck,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ReceiptPrint } from "@/components/pos/receipt-print";
import { ProductMedia } from "@/components/products/product-media";
import { useDriverRuntime } from "@/hooks/use-driver-runtime";
import { formatCurrency } from "@/lib/utils";
import type {
  DriverPosContextDto,
  DriverPosProductDto,
  SaleDto,
} from "@/types/operations-dto";

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
  const [customerId, setCustomerId] = React.useState(() =>
    resolveInitialCustomerId(initialContext, initialCustomerId),
  );
  const [paymentMethod, setPaymentMethod] = React.useState("CASH");
  const [paidAmount, setPaidAmount] = React.useState("");
  const [lastSale, setLastSale] = React.useState<SaleDto | null>(null);
  const [busy, setBusy] = React.useState(false);

  const productById = React.useMemo(
    () => new Map(context.products.map((product) => [product.id, product])),
    [context.products],
  );

  const selectedCustomerId = React.useMemo(
    () =>
      context.customers.some((customer) => customer.id === customerId) ? customerId : "",
    [context.customers, customerId],
  );

  const filteredProducts = React.useMemo(() => {
    const query = normalize(search);
    if (!query) return context.products;
    return context.products.filter((product) =>
      normalize(`${product.name} ${product.reference} ${product.barcode ?? ""}`).includes(query),
    );
  }, [context.products, search]);

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

  function addProduct(product: DriverPosProductDto) {
    setCart((current) => {
      const existing = current.find((line) => line.productId === product.id);
      if (!existing) {
        return [...current, { productId: product.id, quantity: 1, discountRate: 0 }];
      }
      if (existing.quantity >= product.availableQuantity) return current;
      return current.map((line) =>
        line.productId === product.id ? { ...line, quantity: line.quantity + 1 } : line,
      );
    });
  }

  function updateQuantity(productId: string, quantity: number) {
    const max = productById.get(productId)?.availableQuantity ?? 1;
    setCart((current) =>
      current.map((line) =>
        line.productId === productId
          ? { ...line, quantity: Math.min(Math.max(1, quantity), max) }
          : line,
      ),
    );
  }

  function removeProduct(productId: string) {
    setCart((current) => current.filter((line) => line.productId !== productId));
  }

  async function refreshContext() {
    const refreshed = await fetch("/api/driver/pos", { cache: "no-store" });
    const refreshedPayload = (await refreshed.json()) as { context?: DriverPosContextDto };
    if (refreshedPayload.context) setContext(refreshedPayload.context);
  }

  async function validateSale() {
    const handledCustomerId = selectedCustomerId || null;
    setBusy(true);
    try {
      const response = await fetch("/api/driver/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: selectedCustomerId || null,
          paymentMethod,
          paidAmount: paidAmount ? Number(paidAmount) : undefined,
          lines: cart,
        }),
      });
      const payload = (await response.json()) as { sale?: SaleDto; message?: string };
      if (!response.ok || !payload.sale) {
        toast.error(payload.message ?? "Impossible de valider la vente.");
        return;
      }

      setLastSale(payload.sale);
      setCart([]);
      setPaidAmount("");
      setPaymentMethod("CASH");
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

  function printLastSale() {
    if (!lastSale) {
      toast.error("Veuillez d'abord encaisser la vente.");
      return;
    }

    window.setTimeout(() => window.print(), 0);
  }

  if (!context.canSell) {
    return <StateCard message={context.message ?? "La vente est impossible."} />;
  }

  return (
    <div className="space-y-4 pb-28 lg:pb-6">
      <div className="rounded-[28px] bg-[linear-gradient(135deg,#065f46_0%,#10b981_55%,#a7f3d0_100%)] p-4 text-white shadow-[0_18px_45px_rgba(5,150,105,0.28)]">
        <div className="flex flex-col gap-4">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.24em] text-white/75">
              POS Chauffeur
            </p>
            <h1 className="font-heading text-2xl font-semibold">Vendre depuis le camion</h1>
            <p className="text-sm text-white/80">
              Stock strictement preleve sur le camion affecte au chauffeur connecte.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <InfoChip
              icon={<UserRound className="h-4 w-4" />}
              label="Chauffeur"
              value={context.driver.name}
            />
            <InfoChip
              icon={<Truck className="h-4 w-4" />}
              label="Camion"
              value={`${context.truck?.code ?? "-"} - ${context.truck?.registration ?? "-"}`}
            />
            <InfoChip
              icon={<Package2 className="h-4 w-4" />}
              label="Produits dispo"
              value={String(context.products.length)}
            />
          </div>

          {context.tour && (
            <div className="flex items-center gap-2 text-sm text-white/90">
              <Badge variant="secondary">Tournée en cours</Badge>
              <span>
                {context.tour.code} • {context.tour.status}
              </span>
            </div>
          )}

          {lastSale && (
            <div className="flex flex-col gap-2 rounded-2xl bg-white/14 px-3 py-2 text-sm backdrop-blur sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                Facture {lastSale.invoiceNumber} enregistree
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={printLastSale}
                className="rounded-xl"
              >
                <Printer className="h-4 w-4" />
                Imprimer
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <Card className="overflow-hidden rounded-[24px] border-0 ring-0 shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
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
                  const fullyUsed = inCartQuantity >= product.availableQuantity;

                  return (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => addProduct(product)}
                      disabled={fullyUsed}
                      className="group overflow-hidden rounded-[22px] border border-border bg-card text-left transition hover:border-emerald-200 hover:shadow-[0_10px_24px_rgba(16,185,129,0.14)] disabled:cursor-not-allowed disabled:opacity-55"
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
                            <p className="text-xs text-muted-foreground">
                              Stock: {product.availableQuantity}
                            </p>
                          </div>
                          <Badge variant={fullyUsed ? "outline" : "secondary"}>
                            {fullyUsed ? "Maximum" : inCartQuantity > 0 ? `${inCartQuantity} au panier` : "Ajouter"}
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

        <div className="space-y-4 xl:sticky xl:top-20 xl:self-start">
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

              <div className="grid gap-3">
                <Field label="Client">
                  <select
                    value={selectedCustomerId}
                    onChange={(event) => setCustomerId(event.target.value)}
                    className="h-10 rounded-2xl border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Client comptoir</option>
                    {context.customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.name}
                      </option>
                    ))}
                  </select>
                </Field>

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
                                max={row.product.availableQuantity}
                                value={row.quantity}
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
                <Summary label="Total TTC" value={totals.ttc} strong />
              </div>

              <div className="hidden xl:block">
                <Button
                  type="button"
                  disabled={busy || cartRows.length === 0}
                  onClick={validateSale}
                  className="h-12 w-full rounded-2xl"
                >
                  <ShoppingCart className="h-4 w-4" />
                  Valider la vente
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/96 p-3 backdrop-blur xl:hidden">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="min-w-0 flex-1 rounded-2xl bg-muted/60 px-4 py-3">
            <p className="text-xs text-muted-foreground">
              {totals.quantity} article{totals.quantity > 1 ? "s" : ""}
            </p>
            <p className="truncate text-sm font-semibold text-foreground">
              Total {formatCurrency(totals.ttc)}
            </p>
          </div>
          <Button
            type="button"
            disabled={busy || cartRows.length === 0}
            onClick={validateSale}
            className="h-12 rounded-2xl px-5"
          >
            <ShoppingCart className="h-4 w-4" />
            Valider
          </Button>
        </div>
      </div>

      <ReceiptPrint sale={lastSale} />
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

function InfoChip({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl bg-white/12 p-3 backdrop-blur">
      <div className="mb-2 flex items-center gap-2 text-white/72">
        {icon}
        <span className="text-xs uppercase tracking-[0.2em]">{label}</span>
      </div>
      <p className="text-sm font-medium text-white">{value}</p>
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

function resolveInitialCustomerId(
  context: DriverPosContextDto,
  initialCustomerId?: string | null,
) {
  if (!initialCustomerId) {
    return "";
  }

  return context.customers.some((customer) => customer.id === initialCustomerId)
    ? initialCustomerId
    : "";
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
