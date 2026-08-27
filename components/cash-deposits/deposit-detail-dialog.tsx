"use client";

import * as React from "react";
import { Printer } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";
import type { CashDepositDto } from "@/types/cash-deposits";
import { DepositReceiptPrint } from "@/components/cash-deposits/deposit-receipt-print";

type DepositDetailDialogProps = {
  depositId: string | null;
  onOpenChange: (open: boolean) => void;
};

const statusLabels: Record<string, string> = {
  VALIDATED: "Valide",
  CANCELLED: "Annule",
};

export function DepositDetailDialog({ depositId, onOpenChange }: DepositDetailDialogProps) {
  const [deposit, setDeposit] = React.useState<CashDepositDto | null>(null);

  React.useEffect(() => {
    if (!depositId) return;
    let active = true;
    fetch(`/api/cash-deposits/${depositId}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((body: { deposit?: CashDepositDto; message?: string }) => {
        if (!active) return;
        if (!body.deposit) {
          toast.error(body.message ?? "Impossible de charger ce versement.");
          return;
        }
        setDeposit(body.deposit);
      });
    return () => {
      active = false;
    };
  }, [depositId]);

  // Never render a previous deposit's data under a new/closed depositId -
  // derived directly instead of clearing state from the effect above.
  const displayedDeposit = depositId && deposit?.id === depositId ? deposit : null;
  const loading = depositId !== null && displayedDeposit === null;

  function handlePrint() {
    window.setTimeout(() => window.print(), 0);
  }

  return (
    <Dialog open={depositId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle className="text-xl">
              {displayedDeposit ? displayedDeposit.number : "Versement"}
            </DialogTitle>
            {displayedDeposit ? (
              <Badge variant={displayedDeposit.status === "VALIDATED" ? "secondary" : "destructive"}>
                {statusLabels[displayedDeposit.status] ?? displayedDeposit.status}
              </Badge>
            ) : null}
          </div>
          <DialogDescription>
            {displayedDeposit
              ? `${displayedDeposit.depotName} - ${new Date(displayedDeposit.date).toLocaleDateString("fr-FR")}`
              : "Chargement du detail..."}
          </DialogDescription>
        </DialogHeader>

        {loading || !displayedDeposit ? (
          <p className="px-1 py-8 text-center text-sm text-muted-foreground">Chargement...</p>
        ) : (
          <div className="flex-1 space-y-4 overflow-y-auto px-1 py-1">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">Caissier</p>
                <p className="text-sm font-medium text-foreground">
                  {displayedDeposit.createdByUserName}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Heure</p>
                <p className="text-sm font-medium text-foreground">
                  {new Date(displayedDeposit.createdAt).toLocaleTimeString("fr-FR", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">POS / Caisse</p>
                <p className="text-sm font-medium text-foreground">{displayedDeposit.depotName}</p>
              </div>
              {displayedDeposit.posSessionNumber ? (
                <div>
                  <p className="text-xs text-muted-foreground">Session POS</p>
                  <p className="text-sm font-medium text-foreground">
                    #{displayedDeposit.posSessionNumber}
                  </p>
                </div>
              ) : null}
            </div>

            <div className="overflow-x-auto rounded-2xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Coupure</TableHead>
                    <TableHead className="text-right">Quantite</TableHead>
                    <TableHead className="text-right">Montant</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayedDeposit.denominations.map((line) => (
                    <TableRow key={line.denomination}>
                      <TableCell className="font-medium text-foreground tabular-nums">
                        {formatCurrency(line.denomination)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{line.quantity}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(line.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {displayedDeposit.notes ? (
              <p className="text-sm text-muted-foreground">
                Commentaire : {displayedDeposit.notes}
              </p>
            ) : null}

            <div className="rounded-2xl border border-border bg-muted/50 p-4 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total especes</span>
                <span className="font-medium tabular-nums">
                  {formatCurrency(displayedDeposit.cashTotal)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total cheques</span>
                <span className="font-medium tabular-nums">
                  {formatCurrency(displayedDeposit.checkTotal)}
                </span>
              </div>
              <div className="mt-2 flex justify-between border-t border-border pt-2 text-base font-semibold">
                <span>TOTAL VERSEMENT</span>
                <span className="tabular-nums">{formatCurrency(displayedDeposit.total)}</span>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Fermer
          </Button>
          <Button type="button" disabled={!displayedDeposit} onClick={handlePrint}>
            <Printer className="h-4 w-4" />
            Imprimer
          </Button>
        </DialogFooter>
      </DialogContent>

      <DepositReceiptPrint deposit={displayedDeposit} />
    </Dialog>
  );
}
