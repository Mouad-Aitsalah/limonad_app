"use client";

import * as React from "react";
import { toast } from "sonner";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CashDepositContextDto, CashDepositDto, CashDepositSummaryDto } from "@/types/cash-deposits";
import type { DepotDto } from "@/types/operations-dto";
import { NewDepositForm } from "@/components/cash-deposits/new-deposit-form";
import { DepositHistoryTable } from "@/components/cash-deposits/deposit-history-table";
import { DepositDetailDialog } from "@/components/cash-deposits/deposit-detail-dialog";
import { DepositReceiptPrint } from "@/components/cash-deposits/deposit-receipt-print";

type CashDepositsViewProps = {
  initialContext: CashDepositContextDto;
  initialHistory: CashDepositSummaryDto[];
  depots: DepotDto[];
};

export function CashDepositsView({
  initialContext,
  initialHistory,
  depots,
}: CashDepositsViewProps) {
  const [context, setContext] = React.useState(initialContext);
  const [history, setHistory] = React.useState(initialHistory);
  const [activeTab, setActiveTab] = React.useState("new");
  const [detailId, setDetailId] = React.useState<string | null>(null);
  // Single shared print target for the whole "Historique" tab (the detail
  // dialog's own "Imprimer" button and the table's per-row print button both
  // go through this) - one hidden .receipt-print-area at a time, so opening
  // the dialog for one deposit and quick-printing another can never overlap
  // two receipts on the same printed page.
  const [printTarget, setPrintTarget] = React.useState<CashDepositDto | null>(null);

  // Print only after the receipt for THIS deposit has actually rendered.
  React.useEffect(() => {
    if (!printTarget) return;
    window.setTimeout(() => window.print(), 0);
  }, [printTarget]);

  async function printDepositById(id: string) {
    try {
      const response = await fetch(`/api/cash-deposits/${id}`, { cache: "no-store" });
      const body = (await response.json()) as { deposit?: CashDepositDto; message?: string };
      if (!body.deposit) {
        toast.error(body.message ?? "Impossible de charger ce versement.");
        return;
      }
      setPrintTarget(body.deposit);
    } catch {
      toast.error("Impossible de charger ce versement.");
    }
  }

  function upsertHistory(deposit: CashDepositDto) {
    setHistory((current) => {
      const summary: CashDepositSummaryDto = {
        id: deposit.id,
        number: deposit.number,
        date: deposit.date,
        depotId: deposit.depotId,
        depotName: deposit.depotName,
        posSessionId: deposit.posSessionId,
        posSessionNumber: deposit.posSessionNumber,
        cashTotal: deposit.cashTotal,
        checkTotal: deposit.checkTotal,
        total: deposit.total,
        status: deposit.status,
        notes: deposit.notes,
        createdByUserId: deposit.createdByUserId,
        createdByUserName: deposit.createdByUserName,
        createdAt: deposit.createdAt,
      };
      const exists = current.some((item) => item.id === summary.id);
      return exists
        ? current.map((item) => (item.id === summary.id ? summary : item))
        : [summary, ...current];
    });
  }

  function handleDepositCreated(deposit: CashDepositDto, nextContext: CashDepositContextDto) {
    upsertHistory(deposit);
    setContext(nextContext);
  }

  return (
    <div className="space-y-6">
      <div>
        {/* Page type scaled x1.4 (24px -> 33.6px title, 14px -> 19.6px text). */}
        <h1 className="font-heading text-[33.6px] leading-tight font-semibold text-foreground">Versements</h1>
        <p className="text-[19.6px] leading-snug text-muted-foreground">
          Declarez l&apos;argent physiquement present en caisse et consultez l&apos;historique
          par POS.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList variant="line" className="min-h-[4.2rem] rounded-2xl border border-border bg-muted/30 p-1">
          <TabsTrigger value="new" className="px-5 text-[19.6px]">Nouveau versement</TabsTrigger>
          <TabsTrigger value="history" className="px-5 text-[19.6px]">Historique</TabsTrigger>
        </TabsList>

        <TabsContent value="new" className="text-[19.6px]">
          <div className="rounded-3xl border border-border bg-card p-4 shadow-[0_10px_30px_rgba(15,23,42,0.06)] sm:p-6">
            <NewDepositForm context={context} onDepositCreated={handleDepositCreated} />
          </div>
        </TabsContent>

        <TabsContent value="history" className="text-[19.6px]">
          <div className="rounded-3xl border border-border bg-card p-4 shadow-[0_10px_30px_rgba(15,23,42,0.06)] sm:p-6">
            <DepositHistoryTable
              deposits={history}
              depots={depots}
              context={context}
              onOpenDetail={setDetailId}
              onPrint={printDepositById}
            />
          </div>
        </TabsContent>
      </Tabs>

      <DepositDetailDialog
        depositId={detailId}
        onOpenChange={(open) => !open && setDetailId(null)}
        onPrint={setPrintTarget}
      />
      <DepositReceiptPrint deposit={printTarget} />
    </div>
  );
}
