"use client";

import * as React from "react";
import { ArrowLeft, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCustomerCode } from "@/lib/customer-code";
import { formatCurrency } from "@/lib/utils";
import type { SaleDto } from "@/types/operations-dto";
import { defaultPaymentMethod, posPaymentMethods, type PosPaymentMethodValue } from "@/types/pos";

type PendingSalesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sales: SaleDto[];
  busy?: boolean;
  /** Encaisse la facture. Le parent ferme le dialog et réinitialise le POS. */
  onCollect: (saleId: string, method: PosPaymentMethodValue, paidAmount?: number) => Promise<void> | void;
  onPrint: (sale: SaleDto) => void;
};

function hhmm(iso: string) {
  return new Intl.DateTimeFormat("fr-MA", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function customerLabel(sale: SaleDto): string {
  if (!sale.customer) return "Client comptoir";
  return `${formatCustomerCode(sale.customer.code)} · ${sale.customer.name}`;
}

function CollectPanel({
  sale,
  busy,
  onCollect,
  onPrint,
  onBack,
}: {
  sale: SaleDto;
  busy: boolean;
  onCollect: (saleId: string, method: PosPaymentMethodValue, paidAmount?: number) => Promise<void> | void;
  onPrint: (sale: SaleDto) => void;
  onBack: () => void;
}) {
  const total = sale.totalTTC;
  const [method, setMethod] = React.useState<PosPaymentMethodValue>(defaultPaymentMethod);
  const [received, setReceived] = React.useState(total);
  const changeDue = Math.max(0, received - total);

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Retour à la liste
      </button>

      <div className="rounded-2xl border border-border bg-muted/20 p-3 text-sm">
        <p className="font-medium text-foreground">{sale.invoiceNumber}</p>
        <p className="text-muted-foreground">
          {customerLabel(sale)} · {hhmm(sale.createdAt)}
        </p>
        <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
          EN ATTENTE DE RÈGLEMENT
        </span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12 text-right">Qté</TableHead>
              <TableHead>Désignation</TableHead>
              <TableHead className="text-right">Prix TTC</TableHead>
              <TableHead className="text-right">Montant</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sale.lines.map((line) => {
              const unitTTC = line.unitPriceHT * (1 + line.taxRate / 100);
              return (
                <TableRow key={line.id}>
                  <TableCell className="text-right tabular-nums">{line.quantity}</TableCell>
                  <TableCell>{line.productName}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(unitTTC)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(line.totalTTC)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between rounded-2xl border border-border bg-muted/10 px-4 py-3">
        <span className="text-sm font-medium text-muted-foreground">Total TTC</span>
        <span className="text-lg font-semibold tabular-nums">{formatCurrency(total)}</span>
      </div>

      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void onCollect(sale.id, method, method === "MIXED" ? received : undefined);
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="pending-collect-method">Mode de règlement</Label>
          <select
            id="pending-collect-method"
            value={method}
            onChange={(event) => setMethod(event.target.value as PosPaymentMethodValue)}
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-emerald-500 focus:ring-3 focus:ring-emerald-500/15"
          >
            {posPaymentMethods.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {method === "MIXED" ? (
          <div className="space-y-2">
            <Label htmlFor="pending-collect-received">Montant reçu (espèces)</Label>
            <Input
              id="pending-collect-received"
              type="number"
              min={0}
              step="0.01"
              value={received}
              onChange={(event) => setReceived(Number(event.target.value))}
            />
            <p className="text-xs text-muted-foreground">
              Monnaie à rendre : {formatCurrency(changeDue)}
            </p>
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onPrint(sale)}>
            <Printer aria-hidden="true" className="h-4 w-4" />
            Imprimer
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Encaissement..." : "Encaisser"}
          </Button>
        </DialogFooter>
      </form>
    </div>
  );
}

/**
 * "Factures du jour" - la liste des ventes DRAFT non encaissées du jour, avec
 * ouverture d'une facture (consulter / imprimer / encaisser) sans jamais
 * recréer de Sale. Persistées serveur : la liste survit à un refresh.
 */
export function PendingSalesDialog({
  open,
  onOpenChange,
  sales,
  busy = false,
  onCollect,
  onPrint,
}: PendingSalesDialogProps) {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const selected = selectedId ? sales.find((sale) => sale.id === selectedId) ?? null : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setSelectedId(null);
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl">Factures du jour</DialogTitle>
          <DialogDescription>
            {sales.length === 0
              ? "Aucune facture en attente d'encaissement."
              : `${sales.length} facture${sales.length > 1 ? "s" : ""} en attente d'encaissement.`}
          </DialogDescription>
        </DialogHeader>

        {selected ? (
          <CollectPanel
            key={selected.id}
            sale={selected}
            busy={busy}
            onCollect={onCollect}
            onPrint={onPrint}
            onBack={() => setSelectedId(null)}
          />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Heure</TableHead>
                  <TableHead>Référence</TableHead>
                  <TableHead>N° client / Client</TableHead>
                  <TableHead className="text-right">Montant TTC</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sales.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      Aucune facture en attente.
                    </TableCell>
                  </TableRow>
                ) : (
                  sales.map((sale) => (
                    <TableRow key={sale.id}>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {hhmm(sale.createdAt)}
                      </TableCell>
                      <TableCell className="font-medium text-foreground">
                        {sale.invoiceNumber}
                      </TableCell>
                      <TableCell className="truncate">{customerLabel(sale)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatCurrency(sale.totalTTC)}
                      </TableCell>
                      <TableCell>
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                          En attente
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedId(sale.id)}
                        >
                          Ouvrir
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
