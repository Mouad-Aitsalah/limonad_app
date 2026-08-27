"use client";

import * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InvoicesTable } from "@/components/ventes/invoices-table";
import { SalesPagination } from "@/components/ventes/sales-pagination";
import type { SaleDto } from "@/types/operations-dto";

const PAGE_SIZE = 8;

type InvoicesDrilldownDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  invoices: SaleDto[];
};

export function InvoicesDrilldownDialog({
  open,
  onOpenChange,
  title,
  description,
  invoices,
}: InvoicesDrilldownDialogProps) {
  const [page, setPage] = React.useState(1);

  const sorted = React.useMemo(
    () =>
      [...invoices].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [invoices],
  );

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginated = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setPage(1);
        onOpenChange(next);
      }}
    >
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="text-xl">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-1 py-1">
          <InvoicesTable invoices={paginated} />
          <SalesPagination page={currentPage} totalPages={totalPages} onPageChange={setPage} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
