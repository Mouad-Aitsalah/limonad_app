"use client";

import * as React from "react";
import { toast } from "sonner";

import { EmployeePayrollHistoryTable } from "@/components/employees/employee-payroll-history-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  employeeTransactionStatusLabels,
  employeeTransactionTypeLabels,
  periodInputToParts,
} from "@/lib/employee-payroll";
import { formatCurrency } from "@/lib/utils";
import type {
  EmployeeOptionDto,
  EmployeePayrollContextDto,
  EmployeeTransactionDto,
  EmployeeTransactionStatus,
  EmployeeTransactionType,
} from "@/types/employees";

type EmployeePayrollViewProps = {
  employees: EmployeeOptionDto[];
  initialTransactions: EmployeeTransactionDto[];
  initialContext: EmployeePayrollContextDto | null;
  initialEmployeeId: string;
  initialPeriodInput: string;
  currentUserName: string | null;
};

export function EmployeePayrollView({
  employees,
  initialTransactions,
  initialContext,
  initialEmployeeId,
  initialPeriodInput,
  currentUserName,
}: EmployeePayrollViewProps) {
  const [selectedEmployeeId, setSelectedEmployeeId] = React.useState(initialEmployeeId);
  const [periodInput, setPeriodInput] = React.useState(initialPeriodInput);
  const [transactionDate, setTransactionDate] = React.useState(todayInputValue());
  const [type, setType] = React.useState<EmployeeTransactionType>("ADVANCE");
  const [status, setStatus] = React.useState<EmployeeTransactionStatus>("VALIDATED");
  const [amount, setAmount] = React.useState("");
  const [comment, setComment] = React.useState("");
  const [context, setContext] = React.useState<EmployeePayrollContextDto | null>(initialContext);
  const [transactions, setTransactions] = React.useState(initialTransactions);
  const [search, setSearch] = React.useState("");
  const [historyStatus, setHistoryStatus] = React.useState<"all" | EmployeeTransactionStatus>("all");
  const [historyType, setHistoryType] = React.useState<"all" | EmployeeTransactionType>("all");
  const [submitting, setSubmitting] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = React.useState(() => newIdempotencyKey());

  const filteredTransactions = transactions.filter((transaction) => {
    const haystack = normalize(
      [
        transaction.number,
        transaction.employeeCode,
        transaction.employeeName,
        transaction.comment ?? "",
        transaction.createdByUserName,
      ].join(" "),
    );
    const matchesSearch = search.length === 0 || haystack.includes(normalize(search));
    const matchesStatus = historyStatus === "all" || transaction.status === historyStatus;
    const matchesType = historyType === "all" || transaction.type === historyType;
    return matchesSearch && matchesStatus && matchesType;
  });

  async function refreshTransactions() {
    const response = await fetch("/api/employees/payroll-operations", { cache: "no-store" });
    const payload = (await response.json()) as {
      items?: EmployeeTransactionDto[];
      message?: string;
    };
    if (!response.ok || !payload.items) {
      throw new Error(payload.message ?? "Impossible de recharger l'historique global.");
    }
    setTransactions(payload.items);
  }

  async function refreshContext(employeeId: string, nextPeriodInput: string) {
    if (!employeeId) {
      setContext(null);
      return;
    }
    const nextPeriod = periodInputToParts(nextPeriodInput);
    const response = await fetch(
      `/api/employees/payroll-context?employeeId=${employeeId}&payrollYear=${nextPeriod.payrollYear}&payrollMonth=${nextPeriod.payrollMonth}`,
      { cache: "no-store" },
    );
    const payload = (await response.json()) as {
      context?: EmployeePayrollContextDto;
      message?: string;
    };
    if (!response.ok || !payload.context) {
      throw new Error(payload.message ?? "Impossible de charger la situation du mois.");
    }
    setContext(payload.context);
    applySuggestedAmount(type, payload.context, setAmount);
  }

  async function handleEmployeeChange(nextEmployeeId: string) {
    setSelectedEmployeeId(nextEmployeeId);
    try {
      await refreshContext(nextEmployeeId, periodInput);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Impossible de charger la situation employe.",
      );
    }
  }

  async function handlePeriodChange(nextPeriodInput: string) {
    setPeriodInput(nextPeriodInput);
    if (!selectedEmployeeId) return;
    try {
      await refreshContext(selectedEmployeeId, nextPeriodInput);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Impossible de charger la periode.",
      );
    }
  }

  function handleTypeChange(nextType: EmployeeTransactionType) {
    setType(nextType);
    applySuggestedAmount(nextType, context, setAmount);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEmployeeId) {
      toast.error("Selectionnez un employe.");
      return;
    }

    const nextPeriod = periodInputToParts(periodInput);
    setSubmitting(true);
    try {
      const response = await fetch("/api/employees/payroll-operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: selectedEmployeeId,
          transactionDate,
          payrollYear: nextPeriod.payrollYear,
          payrollMonth: nextPeriod.payrollMonth,
          type,
          amount: Number(amount || 0),
          comment: comment || null,
          status,
          idempotencyKey,
        }),
      });
      const payload = (await response.json()) as {
        transaction?: EmployeeTransactionDto;
        message?: string;
        fieldErrors?: Record<string, string>;
      };

      if (!response.ok || !payload.transaction) {
        throw new Error(payload.message ?? "Impossible d'enregistrer l'operation.");
      }

      toast.success(
        status === "VALIDATED" ? "Operation validee." : "Operation enregistree en brouillon.",
      );
      await Promise.all([refreshTransactions(), refreshContext(selectedEmployeeId, periodInput)]);
      setType("ADVANCE");
      setStatus("VALIDATED");
      setComment("");
      setAmount("");
      setIdempotencyKey(newIdempotencyKey());
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Impossible d'enregistrer l'operation.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAction(transactionId: string, action: "validate" | "cancel") {
    setBusyId(transactionId);
    try {
      const response = await fetch(`/api/employees/payroll-operations/${transactionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = (await response.json()) as {
        transaction?: EmployeeTransactionDto;
        message?: string;
      };
      if (!response.ok || !payload.transaction) {
        throw new Error(payload.message ?? "Operation impossible.");
      }

      toast.success(action === "validate" ? "Brouillon valide." : "Brouillon annule.");
      await refreshTransactions();
      if (selectedEmployeeId) {
        await refreshContext(selectedEmployeeId, periodInput);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Operation impossible.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Avances / Salaire
        </h1>
        <p className="text-sm text-muted-foreground">
          Enregistrez les avances, la remuneration du personnel et le transfert du reste du salaire.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
          <CardContent className="py-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Numero operation</label>
                <Input value="Genere a la validation serveur" disabled />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Date transaction</label>
                <Input
                  type="date"
                  value={transactionDate}
                  onChange={(event) => setTransactionDate(event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Employe</label>
                <select
                  value={selectedEmployeeId}
                  onChange={(event) => void handleEmployeeChange(event.target.value)}
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none"
                >
                  <option value="">Selectionner</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.employeeCode} - {employee.fullName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Periode</label>
                <input
                  type="month"
                  value={periodInput}
                  onChange={(event) => void handlePeriodChange(event.target.value)}
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Type operation</label>
                <select
                  value={type}
                  onChange={(event) =>
                    handleTypeChange(event.target.value as EmployeeTransactionType)
                  }
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none"
                >
                  {Object.entries(employeeTransactionTypeLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Montant</label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Statut</label>
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value as EmployeeTransactionStatus)}
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none"
                >
                  <option value="VALIDATED">{employeeTransactionStatusLabels.VALIDATED}</option>
                  <option value="DRAFT">{employeeTransactionStatusLabels.DRAFT}</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Utilisateur ayant saisi</label>
                <Input value={currentUserName ?? "-"} disabled />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Commentaire</label>
                <Textarea
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="Observation sur l'operation..."
                />
              </div>

              <Button type="submit" size="lg" className="w-full" disabled={submitting}>
                {submitting
                  ? "Enregistrement..."
                  : status === "VALIDATED"
                    ? "Valider"
                    : "Enregistrer le brouillon"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              label="Salaire mensuel"
              value={context ? formatCurrency(context.salary) : "-"}
            />
            <SummaryCard
              label="Somme avances"
              value={context ? formatCurrency(context.advanceTotal) : "-"}
            />
            <SummaryCard
              label="Reste du salaire"
              value={context ? formatCurrency(context.remainingSalary) : "-"}
            />
            <SummaryCard
              label="Montant deja regle"
              value={context ? formatCurrency(context.paidAmount) : "-"}
            />
          </div>

          <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
            <CardContent className="space-y-4 py-6">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Info
                  label="Compte avance"
                  value={
                    context?.advanceAccount
                      ? `${context.advanceAccount.code} - ${context.advanceAccount.name}`
                      : "-"
                  }
                />
                <Info
                  label="Compte salaire"
                  value={
                    context?.salaryAccount
                      ? `${context.salaryAccount.code} - ${context.salaryAccount.name}`
                      : "-"
                  }
                />
                <Info
                  label="Remuneration constatee"
                  value={context ? formatCurrency(context.remunerationTotal) : "-"}
                />
                <Info
                  label="Etat du mois"
                  value={context ? (context.isSettled ? "Solde" : "En cours") : "-"}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
        <CardContent className="space-y-5 py-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Historique global</h2>
              <p className="text-sm text-muted-foreground">
                Plus recent en premier, tous employes confondus.
              </p>
            </div>

            <div className="grid gap-3 lg:grid-cols-3">
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Rechercher numero, code, employe..."
              />
              <select
                value={historyType}
                onChange={(event) =>
                  setHistoryType(event.target.value as "all" | EmployeeTransactionType)
                }
                className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm outline-none"
              >
                <option value="all">Tous les types</option>
                {Object.entries(employeeTransactionTypeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <select
                value={historyStatus}
                onChange={(event) =>
                  setHistoryStatus(event.target.value as "all" | EmployeeTransactionStatus)
                }
                className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm outline-none"
              >
                <option value="all">Tous les statuts</option>
                <option value="DRAFT">{employeeTransactionStatusLabels.DRAFT}</option>
                <option value="VALIDATED">{employeeTransactionStatusLabels.VALIDATED}</option>
                <option value="CANCELLED">{employeeTransactionStatusLabels.CANCELLED}</option>
              </select>
            </div>
          </div>

          <EmployeePayrollHistoryTable
            transactions={filteredTransactions}
            showEmployee
            onValidate={(transactionId) => void handleAction(transactionId, "validate")}
            onCancel={(transactionId) => void handleAction(transactionId, "cancel")}
            busyId={busyId}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
      <CardContent>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
      </CardContent>
    </Card>
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

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function newIdempotencyKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `emp-${Date.now()}`;
}

function applySuggestedAmount(
  type: EmployeeTransactionType,
  context: EmployeePayrollContextDto | null,
  setAmount: (value: string) => void,
) {
  if (!context) return;
  if (type === "TRANSFER") {
    setAmount(String(context.remainingSalary));
    return;
  }
  if (type === "REMUNERATION_PERSONNEL") {
    setAmount(String(context.salary));
  }
}
