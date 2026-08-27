"use client";

import * as React from "react";
import { Eye, FileX, MoreHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { formatCurrency } from "@/lib/utils";
import type { SaleDto } from "@/types/operations-dto";

type InvoicesTableProps = {
  invoices: SaleDto[];
};

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function InvoicesTable({ invoices }: InvoicesTableProps) {
  const [viewingInvoiceId, setViewingInvoiceId] = React.useState<string | null>(null);

  const viewingInvoice = invoices.find((invoice) => invoice.id === viewingInvoiceId) ?? null;

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
            const articleCount = invoice.lines.reduce((sum, line) => sum + line.quantity, 0);
            const net = invoice.net ?? invoice.totalTTC;

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
                <TableCell className="text-right tabular-nums">{articleCount}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(invoice.totalTTC)}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatCurrency(net)}
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
                      <DropdownMenuItem onClick={() => setViewingInvoiceId(invoice.id)}>
                        <Eye aria-hidden="true" />
                        Voir détails
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <InvoiceDetailDialog
        invoice={viewingInvoice}
        open={viewingInvoiceId !== null}
        onOpenChange={(open) => {
          if (!open) setViewingInvoiceId(null);
        }}
      />
    </>
  );
}
