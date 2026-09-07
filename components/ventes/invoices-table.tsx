"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Ban, Eye, FileX, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { InvoiceDetailDialog } from "@/components/ventes/invoice-detail-dialog";
import { InvoiceStatusBadge } from "@/components/ventes/invoice-status-badge";
import { paymentMethodLabels } from "@/components/ventes/orders-toolbar";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/lib/utils";
import type { SaleHistoryListItemDto } from "@/types/operations-dto";

type InvoicesTableProps = {
  invoices: SaleHistoryListItemDto[];
  onSaleChanged?: () => void | Promise<void>;
};

// Terminal statuses: nothing left to cancel.
const CANCELLABLE_STATUSES = new Set([
  "DRAFT",
  "VALIDATED",
  "PARTIALLY_PAID",
  "PAID",
  "CREDIT",
]);

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function InvoicesTable({ invoices, onSaleChanged }: InvoicesTableProps) {
  const router = useRouter();
  const { currentUser } = useAuth();
  const isAdmin =
    currentUser?.role === "admin" || currentUser?.role === "super_admin";

  const [viewingInvoice, setViewingInvoice] = React.useState<SaleHistoryListItemDto | null>(null);
  const [cancelTarget, setCancelTarget] = React.useState<SaleHistoryListItemDto | null>(null);
  const [cancelling, setCancelling] = React.useState(false);

  const cancelIsDraft = cancelTarget?.status === "DRAFT";

  async function confirmCancel() {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      const response = await fetch(`/api/sales/${cancelTarget.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt: cancelTarget.updatedAt }),
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? "Impossible d'annuler la facture.");
      }
      toast.success(
        `Facture ${cancelTarget.displayNumber} ${cancelIsDraft ? "supprimée" : "annulée"}.`,
      );
      setCancelTarget(null);
      await onSaleChanged?.();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Impossible d'annuler la facture.",
      );
    } finally {
      setCancelling(false);
    }
  }

  if (invoices.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <FileX aria-hidden="true" className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          Aucune commande ne correspond à ces critères.
        </p>
      </div>
    );
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Commande</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Client</TableHead>
            <TableHead>Chauffeur / utilisateur</TableHead>
            <TableHead className="text-right">Articles</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="text-right">Net</TableHead>
            <TableHead>Paiement</TableHead>
            <TableHead>Statut</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.map((invoice) => {
            const canCancel = isAdmin && CANCELLABLE_STATUSES.has(invoice.status);
            const canEdit =
              isAdmin &&
              CANCELLABLE_STATUSES.has(invoice.status) &&
              invoice.origin === "COUNTER";
            const isDraft = invoice.status === "DRAFT";
            return (
              <TableRow key={invoice.id}>
                <TableCell className="font-medium text-foreground">
                  {invoice.displayNumber}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDateTime(invoice.createdAt)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {invoice.customer?.name ?? "Client comptoir"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {invoice.driver?.name ?? invoice.createdByUserName}
                </TableCell>
                <TableCell className="text-right tabular-nums">{invoice.articleCount}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(invoice.totalTTC)}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatCurrency(invoice.net)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {paymentMethodLabels[invoice.paymentMethod] ?? invoice.paymentMethod}
                </TableCell>
                <TableCell>
                  <InvoiceStatusBadge status={invoice.status} />
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Actions pour la commande ${invoice.displayNumber}`}
                        />
                      }
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setViewingInvoice(invoice)}>
                        <Eye aria-hidden="true" />
                        Voir détails
                      </DropdownMenuItem>
                      {canEdit ? (
                        <DropdownMenuItem
                          onClick={() => router.push(`/pos?editSaleId=${invoice.id}`)}
                        >
                          <Pencil aria-hidden="true" />
                          Modifier
                        </DropdownMenuItem>
                      ) : null}
                      {canCancel ? (
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setCancelTarget(invoice)}
                        >
                          {isDraft ? (
                            <Trash2 aria-hidden="true" />
                          ) : (
                            <Ban aria-hidden="true" />
                          )}
                          {isDraft ? "Supprimer" : "Annuler la facture"}
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <InvoiceDetailDialog
        listItem={viewingInvoice}
        open={viewingInvoice !== null}
        onOpenChange={(open) => {
          if (!open) setViewingInvoice(null);
        }}
      />

      <Dialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open && !cancelling) setCancelTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {cancelIsDraft ? "Supprimer" : "Annuler"} la facture {cancelTarget?.displayNumber} ?
            </DialogTitle>
            <DialogDescription>
              Cette action restaure le stock, contre-passe les écritures comptables,
              remet à zéro les paiements et corrige la dette client. Le numéro{" "}
              {cancelTarget?.displayNumber} reste réservé et la facture reste visible
              avec le statut « Annulée ». Opération irréversible.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCancelTarget(null)}
              disabled={cancelling}
            >
              Retour
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void confirmCancel()}
              disabled={cancelling}
            >
              {cancelling
                ? "Traitement…"
                : cancelIsDraft
                  ? "Supprimer la facture"
                  : "Annuler la facture"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
