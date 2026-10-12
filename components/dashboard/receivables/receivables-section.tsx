"use client";

import * as React from "react";

import { AnalysisKpiCard, AnalysisState, EmptyAnalysis, InfoHint } from "@/components/dashboard/commercial/analysis-ui";
import { useAnalysisData } from "@/components/dashboard/commercial/use-analysis-data";
import { OverdueDaysSetting } from "@/components/dashboard/receivables/overdue-days-setting";
import { ReceivablesAgingChart } from "@/components/dashboard/receivables/receivables-aging-chart";
import { ReceivablesCustomerDetailDialog } from "@/components/dashboard/receivables/receivables-customer-detail";
import { ReceivablesDebtorsTable } from "@/components/dashboard/receivables/receivables-debtors-table";
import { CASH_NOTE_HINT, formatDay } from "@/components/dashboard/receivables/receivables-format";
import { SectionCard } from "@/components/ui/section-card";
import { cn, formatCurrency } from "@/lib/utils";
import type { ReceivablesOverviewDto, ReceivablesSettings } from "@/types/receivables";

const TOTAL_HINT =
  "Somme des soldes dus des clients : ventes à crédit (montant resté à crédit à la vente) − avoirs clients validés − règlements validés. Même calcul que « Solde clients » et la carte « Créances clients » du Dashboard. Les soldes créditeurs ne sont pas déduits.";
const DEBTORS_HINT = "Clients dont le solde dû est strictement positif.";
const OVER30_HINT =
  "Part des créances dont la vente à crédit d'origine a plus de 30 jours (journées commerciales), après imputation FIFO des avoirs et règlements. Seuil fixe, indépendant du délai de retard.";

function overdueHint(days: number) {
  return `Part des créances dont la vente à crédit d'origine a plus de ${days} jours (délai de retard réglé par l'admin), après imputation FIFO des avoirs et règlements - une estimation, les règlements n'étant pas affectés aux factures.`;
}

/**
 * Dashboard « Créances clients » (admin only - see page.tsx and
 * lib/receivables/access.ts; the API refuses every other role). Read only.
 */
export function ReceivablesSection() {
  const [version, setVersion] = React.useState(0);
  const { loading, data, lastData, error, retry } = useAnalysisData<ReceivablesOverviewDto>(`/api/dashboard/receivables?v=${version}`);
  const [openCustomerId, setOpenCustomerId] = React.useState<string | null>(null);

  return (
    <>
      <ReceivablesContent
        data={data ?? lastData}
        loading={loading}
        error={error}
        onRetry={retry}
        onOpenCustomer={setOpenCustomerId}
        onSettingsSaved={() => setVersion((value) => value + 1)}
      />
      <ReceivablesCustomerDetailDialog customerId={openCustomerId} onClose={() => setOpenCustomerId(null)} />
    </>
  );
}

/** The section's content for a given state - separate from the loader so every state can be rendered in tests. */
export function ReceivablesContent({
  data,
  loading,
  error,
  onRetry,
  onOpenCustomer,
  onSettingsSaved,
}: {
  data: ReceivablesOverviewDto | undefined;
  loading: boolean;
  error?: string;
  onRetry: () => void;
  onOpenCustomer: (customerId: string) => void;
  onSettingsSaved: (settings: ReceivablesSettings) => void;
}) {
  return (
    <SectionCard
      title="Créances clients"
      description={
        data
          ? `Soldes dus par les clients au ${formatDay(data.asOfDay)} (journée commerciale, 02:00 → 02:00). Lecture seule.`
          : "Soldes dus par les clients. Lecture seule."
      }
      action={data ? <OverdueDaysSetting settings={data.settings} onSaved={onSettingsSaved} /> : undefined}
      contentClassName="space-y-5"
    >
      <AnalysisState loading={loading} error={error} onRetry={onRetry} />

      {data ? (
        <div className={cn("space-y-6 transition-opacity", loading && "opacity-60")} aria-busy={loading} data-section="receivables">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <AnalysisKpiCard id="receivables-total" label="Total des créances restantes" value={formatCurrency(data.totals.totalOutstanding)} hint={TOTAL_HINT} emphasis />
            <AnalysisKpiCard id="receivables-debtors" label="Clients débiteurs" value={new Intl.NumberFormat("fr-FR").format(data.totals.debtorCount)} hint={DEBTORS_HINT} accent="bg-sky-300" />
            <AnalysisKpiCard
              id="receivables-overdue"
              label={`Créances en retard (> ${data.settings.overdueDays} j)`}
              value={formatCurrency(data.totals.overdue)}
              hint={overdueHint(data.settings.overdueDays)}
              caption="Estimation FIFO"
              accent="bg-red-300"
            />
            <AnalysisKpiCard id="receivables-over30" label="Créances de plus de 30 jours" value={formatCurrency(data.totals.over30)} hint={OVER30_HINT} caption="Estimation FIFO" accent="bg-orange-300" />
          </div>

          {data.totals.debtorCount === 0 ? (
            <EmptyAnalysis>Aucune créance client : aucun client n&apos;a de solde dû.</EmptyAnalysis>
          ) : (
            <>
              <ReceivablesAgingChart buckets={data.buckets} total={data.totals.totalOutstanding} />
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">Clients débiteurs</h3>
                <ReceivablesDebtorsTable rows={data.debtors} overdueDays={data.settings.overdueDays} onOpenCustomer={onOpenCustomer} />
                {data.debtorsTruncated ? (
                  <p role="note" className="text-xs text-muted-foreground">
                    Seuls les {data.debtors.length} plus gros soldes sont listés ; les indicateurs couvrent les {data.totals.debtorCount} clients débiteurs.
                  </p>
                ) : null}
              </div>
            </>
          )}

          <DataNotes data={data} onOpenCustomer={onOpenCustomer} />
        </div>
      ) : null}
    </SectionCard>
  );
}

function DataNotes({ data, onOpenCustomer }: { data: ReceivablesOverviewDto; onOpenCustomer: (customerId: string) => void }) {
  const { creditors, dataNotes } = data;
  return (
    <div className="space-y-2">
      {creditors.count > 0 ? (
        <details className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900" data-note="creditors">
          <summary className="cursor-pointer font-medium">
            Soldes créditeurs : {creditors.count} client{creditors.count > 1 ? "s" : ""}, {formatCurrency(creditors.total)} - affichés à part, jamais déduits du total des créances.
          </summary>
          <ul className="mt-2 space-y-1">
            {creditors.rows.map((row) => (
              <li key={row.customerId} className="flex flex-wrap items-center gap-x-2">
                <button type="button" onClick={() => onOpenCustomer(row.customerId)} className="font-medium underline-offset-2 hover:underline">
                  {row.name}
                </button>
                <span className="text-sky-800/80">compte {row.accountCode}</span>
                <span className="tabular-nums">{formatCurrency(row.creditBalance)}</span>
                {row.explainedByCashCreditNotes ? (
                  <span className="text-amber-900">· entièrement dû à des avoirs enregistrés « espèces » ({formatCurrency(row.cashCreditNotesTotal)}) : probablement pas une somme due au client</span>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {dataNotes.cashCreditNotes.count > 0 ? (
        <p role="note" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-note="cash-credit-notes">
          <span>
            {dataNotes.cashCreditNotes.count} avoir{dataNotes.cashCreditNotes.count > 1 ? "s" : ""} client{dataNotes.cashCreditNotes.count > 1 ? "s" : ""} validé{dataNotes.cashCreditNotes.count > 1 ? "s" : ""}, enregistré{dataNotes.cashCreditNotes.count > 1 ? "s" : ""} « remboursé en espèces » ({formatCurrency(dataNotes.cashCreditNotes.total)}),{" "}
            {dataNotes.cashCreditNotes.count > 1 ? "sont déduits" : "est déduit"} des soldes par le calcul actuel. Ils sont signalés dans le détail de chaque client.
          </span>
          <InfoHint label="Avoirs « espèces »" text={CASH_NOTE_HINT} />
        </p>
      ) : null}
      {dataNotes.agingMismatchCount > 0 ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          L&apos;ancienneté de {dataNotes.agingMismatchCount} client(s) n&apos;a pas pu être rapprochée de leur solde : leur répartition est incomplète (le solde reste exact).
        </p>
      ) : null}
    </div>
  );
}
