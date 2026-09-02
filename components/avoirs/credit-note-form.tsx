"use client";

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  computeCreditNoteLineTotals,
  computeCreditNoteTotals,
  creditNoteReasonLabels,
} from "@/lib/credit-note-calculations";
import { formatCurrency } from "@/lib/utils";
import type {
  CreateCreditNoteInput,
  CreditNote,
  CreditNoteReason,
  ReturnableProduct,
} from "@/types/credit-note";
import type { CustomerDto } from "@/types/operations-dto";

type CreditNoteFormProps = {
  customers: CustomerDto[];
  onCancel: () => void;
  onSaved: (input: CreateCreditNoteInput, status: CreditNote["status"]) => Promise<void>;
};

type DraftQuantities = Record<string, number>;

const reasons: CreditNoteReason[] = [
  "produit_defectueux",
  "produit_endommage",
  "erreur_livraison",
  "erreur_quantite",
  "produit_non_conforme",
  "autre",
];

export function CreditNoteForm({
  customers,
  onCancel,
  onSaved,
}: CreditNoteFormProps) {
  const [customerSearch, setCustomerSearch] = React.useState("");
  const [customerId, setCustomerId] = React.useState("");
  const [returnDate, setReturnDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = React.useState<CreditNoteReason>("erreur_quantite");
  const [comment, setComment] = React.useState("");
  const [returnables, setReturnables] = React.useState<ReturnableProduct[]>([]);
  const [quantities, setQuantities] = React.useState<DraftQuantities>({});
  const [loadingProducts, setLoadingProducts] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  // Stable for one avoir creation attempt (F5): the parent dialog remounts
  // this form (key={open ? "open" : "closed"}) every time it opens, so a
  // plain useRef initializer already gives a fresh key per attempt and keeps
  // it identical across a retry within the same open dialog session - no
  // manual rotation needed here.
  const idempotencyKeyRef = React.useRef<string>(crypto.randomUUID());

  const selectedCustomer = customers.find((customer) => customer.id === customerId) ?? null;
  const filteredCustomers = React.useMemo(() => {
    const query = normalize(customerSearch);
    if (!query) return customers.slice(0, 20);
    return customers
      .filter((customer) =>
        normalize(`${customer.name} ${customer.code} ${customer.phone}`).includes(query),
      )
      .slice(0, 20);
  }, [customers, customerSearch]);

  const selectedLines = React.useMemo(
    () =>
      returnables
        .map((product) => {
          // F4: linked to the earliest origin with something still
          // returnable (origins is already sorted oldest-first and
          // pre-filtered to quantityReturnable > 0 by getReturnableProducts).
          // The server caps quantityReturned against THAT specific
          // saleLineId, not the product's aggregate across every origin -
          // so the UI must cap the same way here, or a value that looks
          // valid here could still be refused server-side. A product
          // bought across several sales can only be returned against the
          // first one through this form (known limitation - see F4 report).
          const origin = product.origins[0];
          const cap = origin?.quantityReturnable ?? product.returnableQuantity;
          return {
            productId: product.productId,
            quantityReturned: Math.min(Math.max(0, quantities[product.productId] ?? 0), cap),
            unitPrice: product.prices[0] ?? 0,
            discountPercent: origin?.discountPercent ?? 0,
            taxRate: origin?.taxRate ?? 0,
            saleLineId: origin?.saleLineId ?? null,
          };
        })
        .filter((line) => line.quantityReturned > 0),
    [returnables, quantities],
  );
  const totals = computeCreditNoteTotals(selectedLines);

  async function loadReturnables(nextCustomerId: string) {
    setCustomerId(nextCustomerId);
    setQuantities({});
    setReturnables([]);
    if (!nextCustomerId) return;

    setLoadingProducts(true);
    try {
      const response = await fetch(
        `/api/credit-notes/returnables?customerId=${encodeURIComponent(nextCustomerId)}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as {
        products?: ReturnableProduct[];
        message?: string;
      };
      if (!response.ok || !payload.products) {
        toast.error(payload.message ?? "Impossible de charger les produits achetes.");
        return;
      }
      setReturnables(payload.products);
    } finally {
      setLoadingProducts(false);
    }
  }

  function handleQuantityChange(productId: string, value: number, max: number) {
    setQuantities((prev) => ({
      ...prev,
      [productId]: Math.min(Math.max(0, value), max),
    }));
  }

  async function save(status: CreditNote["status"]) {
    if (!selectedCustomer) {
      toast.error("Selectionnez d'abord le client concerne.");
      return;
    }
    if (reason === "autre" && comment.trim().length === 0) {
      toast.error("Le commentaire est obligatoire pour le motif Autre.");
      return;
    }
    if (selectedLines.length === 0) {
      toast.error("Selectionnez au moins un produit a retourner.");
      return;
    }

    setSaving(true);
    try {
      await onSaved(
        {
          customerId: selectedCustomer.id,
          // F4 finalization: this form only ever offers products drawn
          // from the customer's real purchase history (returnables), so
          // every line it can produce already carries a saleLineId - it is
          // always a LINKED return. A dedicated MANUAL-return UI does not
          // exist yet (see the F4 finalization report).
          returnMode: "LINKED",
          reason,
          comment,
          returnDate,
          lines: selectedLines.map((line) => ({
            productId: line.productId,
            quantityReturned: line.quantityReturned,
            saleLineId: line.saleLineId,
          })),
          idempotencyKey: idempotencyKeyRef.current,
        },
        status,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex-1 space-y-5 overflow-y-auto px-1 py-1">
      <div className="grid gap-4 md:grid-cols-[1.4fr_0.6fr]">
        <div className="space-y-2">
          <Label>Client concerne</Label>
          <Input
            value={customerSearch}
            onChange={(event) => setCustomerSearch(event.target.value)}
            placeholder="Rechercher par nom, code client ou telephone..."
          />
          <Select value={customerId} onValueChange={(value) => loadReturnables(value ?? "")}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Selectionner un client">
                {() =>
                  selectedCustomer
                    ? `${selectedCustomer.code} - ${selectedCustomer.name}`
                    : "Selectionner un client"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {filteredCustomers.map((customer) => (
                <SelectItem key={customer.id} value={customer.id}>
                  {customer.code} - {customer.name} - {customer.phone}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="returnDate">Date du retour</Label>
          <Input
            id="returnDate"
            type="date"
            value={returnDate}
            onChange={(event) => setReturnDate(event.target.value)}
          />
        </div>
      </div>

      {selectedCustomer && (
        <div className="grid gap-4 rounded-2xl border border-border bg-muted/40 p-4 md:grid-cols-5">
          <Info label="Code client" value={selectedCustomer.code} />
          <Info label="Telephone" value={selectedCustomer.phone} />
          <Info label="Ville" value={selectedCustomer.city} />
          <Info label="Statut" value={selectedCustomer.status} />
          <Info label="Solde" value={formatCurrency(selectedCustomer.currentBalance)} />
        </div>
      )}

      <div className="rounded-2xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produit</TableHead>
              <TableHead className="text-right">Achete</TableHead>
              <TableHead className="text-right">Deja retourne</TableHead>
              <TableHead className="text-right">Retournable</TableHead>
              <TableHead>Dernier achat</TableHead>
              <TableHead className="text-right">Factures</TableHead>
              <TableHead>Prix</TableHead>
              <TableHead className="text-right">A retourner</TableHead>
              <TableHead className="text-right">Montant</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!selectedCustomer ? (
              <EmptyRow message="Selectionnez un client pour afficher ses produits achetes." />
            ) : loadingProducts ? (
              <EmptyRow message="Chargement des produits achetes..." />
            ) : returnables.length === 0 ? (
              <EmptyRow message="Aucun produit retournable pour ce client." />
            ) : (
              returnables.map((product) => {
                const quantity = quantities[product.productId] ?? 0;
                // F4: same cap the server will actually enforce (see
                // selectedLines above) - the earliest origin's own
                // returnable amount, not the product's aggregate.
                const returnableCap = product.origins[0]?.quantityReturnable ?? product.returnableQuantity;
                const lineTotals = computeCreditNoteLineTotals({
                  productId: product.productId,
                  quantityReturned: quantity,
                  unitPrice: product.prices[0] ?? 0,
                  discountPercent: product.origins[0]?.discountPercent ?? 0,
                  taxRate: product.origins[0]?.taxRate ?? 0,
                });

                return (
                  <TableRow key={product.productId}>
                    <TableCell>
                      <div className="font-medium text-foreground">{product.productName}</div>
                      <div className="text-xs text-muted-foreground">
                        {product.productReference}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{product.totalBought}</TableCell>
                    <TableCell className="text-right tabular-nums">{product.alreadyReturned}</TableCell>
                    <TableCell className="text-right tabular-nums">{product.returnableQuantity}</TableCell>
                    <TableCell>{new Date(product.lastPurchaseDate).toLocaleDateString("fr-FR")}</TableCell>
                    <TableCell className="text-right tabular-nums">{product.invoicesCount}</TableCell>
                    <TableCell>{formatPrices(product.prices)}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        min={0}
                        max={returnableCap}
                        value={quantity}
                        onChange={(event) =>
                          handleQuantityChange(
                            product.productId,
                            Number(event.target.value),
                            returnableCap,
                          )
                        }
                        className="ml-auto h-8 w-20 text-right"
                        aria-label={`Quantite a retourner pour ${product.productName}`}
                      />
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatCurrency(lineTotals.totalTTC)}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Motif</Label>
          <Select
            value={reason}
            onValueChange={(value) => value && setReason(value as CreditNoteReason)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Selectionner un motif">
                {(value: CreditNoteReason | null) =>
                  value ? creditNoteReasonLabels[value] : "Selectionner un motif"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {reasons.map((item) => (
                <SelectItem key={item} value={item}>
                  {creditNoteReasonLabels[item]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="comment">
            Justification {reason === "autre" ? "(obligatoire)" : ""}
          </Label>
          <Textarea
            id="comment"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Precision sur le retour..."
          />
        </div>
      </div>

      <div className="ml-auto max-w-sm space-y-2 rounded-2xl border border-border bg-muted/40 p-4">
        <SummaryLine label="Total HT" value={totals.totalHT} />
        <SummaryLine label="TVA" value={totals.totalTVA} />
        <SummaryLine label="Total TTC" value={totals.totalTTC} strong />
      </div>

      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel}>
          Annuler
        </Button>
        <Button type="button" variant="secondary" disabled={saving} onClick={() => save("BROUILLON")}>
          Enregistrer comme brouillon
        </Button>
        <Button type="button" disabled={saving} onClick={() => save("VALIDE")}>
          Valider l&apos;avoir
        </Button>
      </div>
    </div>
  );
}

function EmptyRow({ message }: { message: string }) {
  return (
    <TableRow>
      <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
        {message}
      </TableCell>
    </TableRow>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

function SummaryLine({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <div
      className={
        strong
          ? "flex items-center justify-between text-base font-semibold"
          : "flex items-center justify-between text-sm"
      }
    >
      <span className={strong ? "text-foreground" : "text-muted-foreground"}>
        {label}
      </span>
      <span
        className={
          strong
            ? "tabular-nums text-emerald-700"
            : "tabular-nums text-foreground"
        }
      >
        {formatCurrency(value)}
      </span>
    </div>
  );
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function formatPrices(prices: number[]) {
  if (prices.length === 0) return "-";
  if (prices.length === 1 && prices[0] !== undefined) return formatCurrency(prices[0]);
  return `${prices.length} prix`;
}
