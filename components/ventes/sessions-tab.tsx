"use client";

import * as React from "react";

import { SessionsTable } from "@/components/ventes/sessions-table";
import { SalesPagination } from "@/components/ventes/sales-pagination";
import { InvoicesDrilldownDialog } from "@/components/ventes/invoices-drilldown-dialog";
import type { PosSessionDto } from "@/types/operations-dto";

const PAGE_SIZE = 10;

type SessionsTabProps = {
  sessions: PosSessionDto[];
};

export function SessionsTab({ sessions }: SessionsTabProps) {
  const [page, setPage] = React.useState(1);
  const [viewingSession, setViewingSession] = React.useState<PosSessionDto | null>(null);

  const totalPages = Math.max(1, Math.ceil(sessions.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginated = sessions.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="space-y-5">
      <SessionsTable sessions={paginated} onViewOrders={setViewingSession} />

      <SalesPagination page={currentPage} totalPages={totalPages} onPageChange={setPage} />

      <InvoicesDrilldownDialog
        open={viewingSession !== null}
        onOpenChange={(open) => {
          if (!open) setViewingSession(null);
        }}
        title={viewingSession ? `Session ${viewingSession.displayNumber}` : ""}
        description="Commandes rattachées à cette session de caisse."
        filters={{ posSessionId: viewingSession?.id }}
      />
    </div>
  );
}
