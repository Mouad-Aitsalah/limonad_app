"use client";

import * as React from "react";
import { toast } from "sonner";
import { Eye, FileX, MoreHorizontal, Pencil, Printer, Trash2 } from "lucide-react";

import { PurchaseDetailDialog } from "@/components/achats/purchase-detail-dialog";
import { PurchaseStatusBadge } from "@/components/achats/purchase-status-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { purchasePaymentLabels } from "@/lib/mock-data/purchase-payment-methods";
import { suppliers as fallbackSuppliers } from "@/lib/mock-data/suppliers";
import { computePurchaseTotals } from "@/lib/purchase-calculations";
import { formatCurrency } from "@/lib/utils";
import type { ProductOptionDto } from "@/types/product-dto";
import type { Purchase } from "@/types/purchase";

function supplierName(purchase: Purchase, supplierOptions: ProductOptionDto[]) {
  return (
    purchase.fournisseurNom ??
    supplierOptions.find((supplier) => supplier.id === purchase.fournisseurId)?.name ??
    fallbackSuppliers.find((supplier) => supplier.id === purchase.fournisseurId)?.nom ??
    "-"
  );
}

function userName(purchase: Purchase) {
  return purchase.utilisateurNom ?? purchase.utilisateurId;
}

type PurchasesTableProps = {
  purchases: Purchase[];
  supplierOptions: ProductOptionDto[];
};

export function PurchasesTable({
  purchases,
  supplierOptions,
}: PurchasesTableProps) {
  const [viewingPurchaseId, setViewingPurchaseId] = React.useState<string | null>(null);

  const viewingPurchase =
    purchases.find((purchase) => purchase.id === viewingPurchaseId) ?? null;

  if (purchases.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <FileX
          aria-hidden="true"
          className="h-10 w-10 text-muted-foreground/40"
        />
        <p className="text-sm text-muted-foreground">
          Aucun achat ne correspond à ces critères.
        </p>
      </div>
    );
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>N° Achat</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Fournisseur</TableHead>
            <TableHead>Utilisateur</TableHead>
            <TableHead className="text-right">Montant HT</TableHead>
            <TableHead className="text-right">TVA</TableHead>
            <TableHead className="text-right">Montant TTC</TableHead>
            <TableHead>Règlement</TableHead>
            <TableHead>Statut</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {purchases.map((purchase) => {
            const totals = computePurchaseTotals(purchase.lignes);

            return (
              <TableRow key={purchase.id}>
                <TableCell className="font-medium text-foreground">
                  {purchase.numero}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {purchase.date.toLocaleDateString("fr-FR", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  })}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {supplierName(purchase, supplierOptions)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {userName(purchase)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(totals.totalHT)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(totals.totalTVA)}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatCurrency(totals.totalTTC)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {purchasePaymentLabels[purchase.modeReglement]}
                </TableCell>
                <TableCell>
                  <PurchaseStatusBadge status={purchase.statut} />
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Actions pour l'achat ${purchase.numero}`}
                        />
                      }
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => setViewingPurchaseId(purchase.id)}
                      >
                        <Eye aria-hidden="true" />
                        Voir
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        <Pencil aria-hidden="true" />
                        Modifier
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        <Printer aria-hidden="true" />
                        Imprimer
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => {
                          toast.info(
                            "La suppression des achats persistés n'est pas encore disponible.",
                          );
                        }}
                      >
                        <Trash2 aria-hidden="true" />
                        Supprimer
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <PurchaseDetailDialog
        purchase={viewingPurchase}
        supplierOptions={supplierOptions}
        open={viewingPurchaseId !== null}
        onOpenChange={(open) => {
          if (!open) setViewingPurchaseId(null);
        }}
      />
    </>
  );
}
