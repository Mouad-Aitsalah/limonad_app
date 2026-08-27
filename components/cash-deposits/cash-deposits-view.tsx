"use client";

import * as React from "react";
import { Banknote, FileCheck, Receipt, Wallet } from "lucide-react";

import { MetricCard } from "@/components/ui/metric-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CashDepositContextDto, CashDepositDto, CashDepositSummaryDto } from "@/types/cash-deposits";
import type { DepotDto } from "@/types/operations-dto";
import { NewDepositForm } from "@/components/cash-deposits/new-deposit-form";
import { DepositHistoryTable } from "@/components/cash-deposits/deposit-history-table";
import { DepositDetailDialog } from "@/components/cash-deposits/deposit-detail-dialog";

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
        <h1 className="font-heading text-2xl font-semibold text-foreground">Versements</h1>
        <p className="text-sm text-muted-foreground">
          Declarez l&apos;argent physiquement present en caisse et consultez l&apos;historique
          par POS.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          eyebrow="Aujourd'hui"
          title="Versements"
          value={String(context.todayCount)}
          icon={Receipt}
          accent="blue"
        />
        <MetricCard
          eyebrow="Aujourd'hui"
          title="Total verse"
          value={formatDh(context.todayTotal)}
          icon={Wallet}
          accent="green"
        />
        <MetricCard
          eyebrow="Aujourd'hui"
          title="Total especes"
          value={formatDh(context.todayCashTotal)}
          icon={Banknote}
          accent="teal"
        />
        <MetricCard
          eyebrow="Aujourd'hui"
          title="Total cheques"
          value={formatDh(context.todayCheckTotal)}
          icon={FileCheck}
          accent="orange"
        />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList variant="line" className="rounded-2xl border border-border bg-muted/30 p-1">
          <TabsTrigger value="new">Nouveau versement</TabsTrigger>
          <TabsTrigger value="history">Historique</TabsTrigger>
        </TabsList>

        <TabsContent value="new">
          <div className="rounded-3xl border border-border bg-card p-4 shadow-[0_10px_30px_rgba(15,23,42,0.06)] sm:p-6">
            <NewDepositForm context={context} onDepositCreated={handleDepositCreated} />
          </div>
        </TabsContent>

        <TabsContent value="history">
          <div className="rounded-3xl border border-border bg-card p-4 shadow-[0_10px_30px_rgba(15,23,42,0.06)] sm:p-6">
            <DepositHistoryTable
              deposits={history}
              depots={depots}
              context={context}
              onOpenDetail={setDetailId}
            />
          </div>
        </TabsContent>
      </Tabs>

      <DepositDetailDialog depositId={detailId} onOpenChange={(open) => !open && setDetailId(null)} />
    </div>
  );
}

function formatDh(value: number) {
  return `${value.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
}
