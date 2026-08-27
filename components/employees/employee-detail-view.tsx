"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";

import { EmployeePayrollHistoryTable } from "@/components/employees/employee-payroll-history-table";
import { EmployeeStatusBadge } from "@/components/employees/employee-status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buttonVariants } from "@/components/ui/button";
import {
  formatPayrollPeriod,
  partsToPeriodInput,
  periodInputToParts,
} from "@/lib/employee-payroll";
import { formatCurrency } from "@/lib/utils";
import type { EmployeeDetailPayload, EmployeePayrollContextDto, EmployeeTransactionDto } from "@/types/employees";

type EmployeeDetailViewProps = {
  detail: EmployeeDetailPayload;
};

export function EmployeeDetailView({ detail }: EmployeeDetailViewProps) {
  const [period, setPeriod] = React.useState<EmployeePayrollContextDto>(detail.period);
  const [history, setHistory] = React.useState<EmployeeTransactionDto[]>(detail.history);
  const [periodInput, setPeriodInput] = React.useState(
    partsToPeriodInput(detail.period.payrollYear, detail.period.payrollMonth),
  );
  const [loading, setLoading] = React.useState(false);

  async function handlePeriodChange(nextValue: string) {
    setPeriodInput(nextValue);
    const next = periodInputToParts(nextValue);
    setLoading(true);
    try {
      const [contextResponse, historyResponse] = await Promise.all([
        fetch(
          `/api/employees/payroll-context?employeeId=${detail.employee.id}&payrollYear=${next.payrollYear}&payrollMonth=${next.payrollMonth}`,
          { cache: "no-store" },
        ),
        fetch(
          `/api/employees/payroll-operations?employeeId=${detail.employee.id}&payrollYear=${next.payrollYear}&payrollMonth=${next.payrollMonth}`,
          { cache: "no-store" },
        ),
      ]);

      const contextPayload = (await contextResponse.json()) as {
        context?: EmployeePayrollContextDto;
        message?: string;
      };
      const historyPayload = (await historyResponse.json()) as {
        items?: EmployeeTransactionDto[];
        message?: string;
      };

      if (!contextResponse.ok || !contextPayload.context) {
        throw new Error(contextPayload.message ?? "Impossible de charger la situation mensuelle.");
      }
      if (!historyResponse.ok || !historyPayload.items) {
        throw new Error(historyPayload.message ?? "Impossible de charger l'historique.");
      }

      setPeriod(contextPayload.context);
      setHistory(historyPayload.items);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Impossible de recharger la periode.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-heading text-2xl font-semibold text-foreground">
              {detail.employee.employeeCode} - {detail.employee.fullName}
            </h1>
            <EmployeeStatusBadge status={detail.employee.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            Fiche employe et historique des avances / salaires.
          </p>
        </div>

        <Link
          href={`/employes/avances-salaire?employeeId=${detail.employee.id}`}
          className={buttonVariants({ size: "lg" })}
        >
          Nouvelle operation
        </Link>
      </div>

      <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
        <CardContent className="grid gap-4 py-6 md:grid-cols-2 xl:grid-cols-4">
          <Info label="Code employe" value={detail.employee.employeeCode} />
          <Info label="Nom" value={detail.employee.fullName} />
          <Info label="Telephone" value={detail.employee.phone ?? "-"} />
          <Info
            label="Date embauche"
            value={
              detail.employee.hireDate
                ? new Date(detail.employee.hireDate).toLocaleDateString("fr-FR")
                : "-"
            }
          />
          <Info
            label="Salaire mensuel"
            value={
              detail.employee.salary != null ? formatCurrency(detail.employee.salary) : "-"
            }
          />
          <Info
            label="Compte avance"
            value={
              detail.employee.advanceAccount
                ? `${detail.employee.advanceAccount.code} - ${detail.employee.advanceAccount.name}`
                : "-"
            }
          />
          <Info
            label="Compte salaire"
            value={
              detail.employee.salaryAccount
                ? `${detail.employee.salaryAccount.code} - ${detail.employee.salaryAccount.name}`
                : "-"
            }
          />
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Periode analysee</p>
            <input
              type="month"
              value={periodInput}
              onChange={(event) => void handlePeriodChange(event.target.value)}
              className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none"
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Salaire du mois" value={formatCurrency(period.salary)} />
        <SummaryCard label="Total avances" value={formatCurrency(period.advanceTotal)} />
        <SummaryCard label="Montant deja regle" value={formatCurrency(period.paidAmount)} />
        <SummaryCard
          label={`Reste - ${formatPayrollPeriod(period.payrollYear, period.payrollMonth)}`}
          value={formatCurrency(period.remainingSalary)}
          accent={period.isSettled ? "text-emerald-700" : undefined}
        />
      </div>

      <Tabs defaultValue="history" className="space-y-4">
        <TabsList>
          <TabsTrigger value="history">Avances & salaires</TabsTrigger>
          <TabsTrigger value="situation">Situation du mois</TabsTrigger>
        </TabsList>

        <TabsContent value="history" className="space-y-4">
          <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
            <CardContent className="space-y-4 py-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">Historique de la periode</h2>
                  <p className="text-sm text-muted-foreground">
                    {formatPayrollPeriod(period.payrollYear, period.payrollMonth)}
                  </p>
                </div>
                {loading ? (
                  <p className="text-sm text-muted-foreground">Chargement...</p>
                ) : null}
              </div>

              <EmployeePayrollHistoryTable transactions={history} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="situation" className="space-y-4">
          <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
            <CardContent className="grid gap-4 py-6 md:grid-cols-2 xl:grid-cols-4">
              <Info label="Salaire" value={formatCurrency(period.salary)} />
              <Info label="Avances" value={formatCurrency(period.advanceTotal)} />
              <Info
                label="Remuneration constatee"
                value={formatCurrency(period.remunerationTotal)}
              />
              <Info label="Reste a payer" value={formatCurrency(period.remainingSalary)} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
      <CardContent>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className={`mt-2 text-2xl font-semibold ${accent ?? "text-foreground"}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
