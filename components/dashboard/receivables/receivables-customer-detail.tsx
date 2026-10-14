"use client";

import Link from "next/link";
import { AlertTriangle, ExternalLink } from "lucide-react";

import { AnalysisState, InfoHint } from "@/components/dashboard/commercial/analysis-ui";
import { useAnalysisData } from "@/components/dashboard/commercial/use-analysis-data";
import {
  BUCKET_STYLES,
  CASH_NOTE_HINT,
  CASH_REFUND_NOT_DEDUCTED_HINT,
  ESTIMATE_NOTE,
  formatDay,
  formatDays,
  methodLabel,
  refundMethodLabel,
  statusLabel,
} from "@/components/dashboard/receivables/receivables-format";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AGING_BUCKETS } from "@/lib/receivables/aging";
import { cn, formatCurrency } from "@/lib/utils";
import type { CustomerReceivableDetailDto, ReceivableMovementDto } from "@/types/receivables";

/** Read-only dialog: the movements behind one customer's balance. Loads only when opened. */
export function ReceivablesCustomerDetailDialog({ customerId, onClose }: { customerId: string | null; onClose: () => void }) {
  return (
    <Dialog open={customerId !== null} onOpenChange={(open) => !open && onClose()}>
      {/* minmax(0,1fr): the wide movements table scrolls inside its own frame instead of widening the dialog */}
      <DialogContent className="max-h-[88vh] grid-cols-[minmax(0,1fr)] overflow-x-hidden overflow-y-auto sm:max-w-4xl">
        {customerId ? <DetailLoader customerId={customerId} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function DetailLoader({ customerId }: { customerId: string }) {
  const { loading, data, error, retry } = useAnalysisData<CustomerReceivableDetailDto>(
    `/api/dashboard/receivables/customers/${encodeURIComponent(customerId)}`,
  );
  if (!data) {
    return (
      <div className="space-y-4">
        <DialogHeader>
          <DialogTitle>Compte client</DialogTitle>
          <DialogDescription>Mouvements pris en compte dans le solde.</DialogDescription>
        </DialogHeader>
        <AnalysisState loading={loading} error={error} onRetry={retry} />
      </div>
    );
  }
  return (
    <>
      <DialogTitle className="sr-only">Compte client {data.customer.name}</DialogTitle>
      <DialogDescription className="sr-only">Mouvements pris en compte dans le solde du client.</DialogDescription>
      <CustomerReceivableDetailBody detail={data} />
    </>
  );
}

function movementBadge(movement: ReceivableMovementDto) {
  switch (movement.kind) {
    case "CREDIT_SALE":
      return <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[0.68rem] font-semibold text-sky-800">Vente à crédit</span>;
    case "SETTLEMENT":
      return <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[0.68rem] font-semibold text-emerald-800">Règlement</span>;
    case "CREDIT_NOTE":
      if (movement.creditNote?.notDeductedFromDebt) {
        return (
          <span data-cash-refund-not-deducted className="rounded bg-slate-100 px-1.5 py-0.5 text-[0.68rem] font-semibold text-slate-800">
            Remboursement espèces
          </span>
        );
      }
      return movement.creditNote?.refundMethod === "CASH" ? (
        <span data-cash-note className="rounded bg-amber-100 px-1.5 py-0.5 text-[0.68rem] font-semibold text-amber-900">
          Avoir « espèces »
        </span>
      ) : (
        <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[0.68rem] font-semibold text-violet-800">Avoir</span>
      );
    default:
      return <span className="rounded bg-muted px-1.5 py-0.5 text-[0.68rem] font-semibold text-muted-foreground">Report</span>;
  }
}

function movementDetail(movement: ReceivableMovementDto): string {
  if (movement.sale) {
    const paid = movement.sale.paidAtSale > 0 ? `, payé à la vente ${formatCurrency(movement.sale.paidAtSale)}` : "";
    return `Facture ${formatCurrency(movement.sale.totalTTC)}${paid} · ${statusLabel(movement.sale.status)} · reste estimé ${formatCurrency(movement.sale.openEstimate)} (${formatDays(movement.sale.ageDays)})`;
  }
  if (movement.creditNote) {
    const sale = movement.creditNote.originalSaleReference
      ? `sur la vente ${movement.creditNote.originalSaleReference} (${statusLabel(movement.creditNote.originalSaleStatus)})`
      : "sans vente d'origine";
    if (movement.creditNote.notDeductedFromDebt) {
      return `Remboursement en espèces de ${formatCurrency(movement.creditNote.notDeductedFromDebt.faceAmount)} · sans effet sur la dette · ${sale}`;
    }
    if (movement.creditNote.refundMethod === "BANK") {
      return `${refundMethodLabel("BANK")} · crédité sur le compte du client · ${sale}`;
    }
    return `Remboursement enregistré : ${refundMethodLabel(movement.creditNote.refundMethod)} · ${sale}`;
  }
  if (movement.settlement) {
    return `${methodLabel(movement.settlement.method)}${movement.settlement.createdByName ? ` · saisi par ${movement.settlement.createdByName}` : ""}`;
  }
  return "Solde cumulé des mouvements plus anciens";
}

/** The detail itself (separate from the loader so it can be rendered with data in tests). */
export function CustomerReceivableDetailBody({ detail }: { detail: CustomerReceivableDetailDto }) {
  const { customer, debt } = detail;
  const credit = detail.rawBalance < 0;
  const excludedTotal = detail.excluded.draftOrCancelledSales + detail.excluded.nonValidatedCreditNotes + detail.excluded.cancelledSettlements;

  return (
    <div className="min-w-0 space-y-5" data-detail={customer.id}>
      <div className="space-y-1 pr-10">
        <h2 className="font-heading text-lg font-semibold text-foreground">{customer.name}</h2>
        <p className="text-sm text-muted-foreground">
          Compte {customer.accountCode} · {statusLabel(customer.status)} · situation au {formatDay(detail.asOfDay)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Figure label="Ventes à crédit" value={formatCurrency(debt.creditSalesTotal)} />
        <Figure label={detail.cashRefundsNotDeducted ? "Avoirs déduits" : "Avoirs validés"} value={`− ${formatCurrency(debt.creditNotesTotal)}`} />
        <Figure label="Règlements validés" value={`− ${formatCurrency(debt.settlementsTotal)}`} />
        <Figure
          label={credit ? "Solde créditeur" : "Solde dû"}
          value={formatCurrency(credit ? -detail.rawBalance : debt.debt)}
          strong
        />
      </div>

      {!detail.reconciled ? (
        <p role="alert" className="flex gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          Le solde cumulé des mouvements ne correspond pas au solde du client : le tableau ci-dessous est incomplet. Le solde affiché reste celui du calcul de référence.
        </p>
      ) : null}
      {credit ? (
        <p role="note" className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
          Les avoirs et règlements dépassent les ventes à crédit : le client a un solde créditeur de {formatCurrency(-detail.rawBalance)}. Il n&apos;est pas compté dans les créances.
        </p>
      ) : null}
      {detail.cashCreditNotes.count > 0 ? (
        <p role="note" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <span>
            {detail.cashCreditNotes.count} avoir{detail.cashCreditNotes.count > 1 ? "s" : ""} enregistré{detail.cashCreditNotes.count > 1 ? "s" : ""} « remboursé en espèces » ({formatCurrency(detail.cashCreditNotes.total)}) {detail.cashCreditNotes.count > 1 ? "sont déduits" : "est déduit"} du solde par le calcul actuel.
          </span>
          <InfoHint label="Avoirs « espèces »" text={CASH_NOTE_HINT} />
        </p>
      ) : null}

      {detail.cashRefundsNotDeducted && detail.cashRefundsNotDeducted.count > 0 ? (
        <p role="note" data-note="cash-refunds-not-deducted" className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800">
          <span>
            {detail.cashRefundsNotDeducted.count} remboursement{detail.cashRefundsNotDeducted.count > 1 ? "s" : ""} en espèces ({formatCurrency(detail.cashRefundsNotDeducted.total)}) {detail.cashRefundsNotDeducted.count > 1 ? "ne sont pas déduits" : "n'est pas déduit"} du solde : l&apos;argent est sorti de la caisse, la dette du client est inchangée.
          </span>
          <InfoHint label="Remboursements espèces" text={CASH_REFUND_NOT_DEDUCTED_HINT} />
        </p>
      ) : null}

      {debt.debt > 0 ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2 text-xs">
            {AGING_BUCKETS.map(({ key }) => (
              <span key={key} className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1">
                <span aria-hidden="true" className={cn("size-2 rounded-full", BUCKET_STYLES[key].dot)} />
                {BUCKET_STYLES[key].label} : <strong className="tabular-nums">{formatCurrency(detail.aging.buckets[key])}</strong>
              </span>
            ))}
            <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-red-800">
              En retard (&gt; {detail.settings.overdueDays} j) : <strong className="ml-1 tabular-nums">{formatCurrency(detail.aging.overdue)}</strong>
            </span>
          </div>
          <p className="text-[0.7rem] text-muted-foreground">{ESTIMATE_NOTE}</p>
        </div>
      ) : null}

      {detail.movements.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          Aucun mouvement pris en compte pour ce client.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border" data-table="receivable-movements">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Mouvement</TableHead>
                <TableHead className="text-right">Débit</TableHead>
                <TableHead className="text-right">Crédit</TableHead>
                <TableHead className="text-right">Solde cumulé</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.movements.map((movement) => (
                <TableRow key={movement.id} data-kind={movement.kind}>
                  <TableCell className="whitespace-nowrap tabular-nums">{formatDay(movement.day)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      {movementBadge(movement)}
                      <span className="font-medium">{movement.label}</span>
                    </div>
                    <p className="mt-0.5 text-[0.7rem] text-muted-foreground">{movementDetail(movement)}</p>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {movement.kind !== "OPENING" && movement.amount > 0 ? formatCurrency(movement.amount) : ""}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {movement.kind !== "OPENING" && movement.amount < 0 ? formatCurrency(-movement.amount) : ""}
                  </TableCell>
                  <TableCell className={cn("text-right font-semibold tabular-nums", movement.balance < 0 && "text-sky-700")}>
                    {formatCurrency(movement.balance)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="space-y-1 text-[0.72rem] text-muted-foreground">
        <p>
          Mouvements comptés par le calcul du solde (le même que « Solde clients » et le Dashboard) : ventes à crédit (montant resté à crédit à la vente, les paiements reçus à la vente en sont déjà déduits),
          avoirs clients validés et règlements validés. Dates en journée commerciale (02:00 → 02:00).
        </p>
        {detail.movementsTruncated ? <p>Historique long : les mouvements les plus anciens sont regroupés sur la première ligne.</p> : null}
        {excludedTotal > 0 ? (
          <p data-excluded>
            Non comptés : {detail.excluded.draftOrCancelledSales} vente(s) en brouillon ou annulée(s), {detail.excluded.nonValidatedCreditNotes} avoir(s) non validé(s) ou annulé(s),{" "}
            {detail.excluded.cancelledSettlements} règlement(s) annulé(s).
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Link
          href={`/comptabilite/reglements-clients?customerId=${encodeURIComponent(customer.id)}`}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-white px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted/40"
        >
          Ouvrir « Règlements clients »
          <ExternalLink aria-hidden="true" className="size-3.5" />
        </Link>
      </div>
    </div>
  );
}

function Figure({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("rounded-xl border border-border px-3 py-2", strong && "border-slate-300 bg-muted/30")}>
      <p className="text-[0.7rem] text-muted-foreground">{label}</p>
      <p className={cn("text-sm tabular-nums", strong ? "font-bold text-foreground" : "font-semibold")}>{value}</p>
    </div>
  );
}
