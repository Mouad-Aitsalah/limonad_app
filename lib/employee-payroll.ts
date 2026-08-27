import type {
  EmployeeTransactionStatus,
  EmployeeTransactionType,
} from "@/types/employees";

export const employeeTransactionTypeLabels: Record<EmployeeTransactionType, string> = {
  ADVANCE: "Avance",
  REMUNERATION_PERSONNEL: "Remuneration du personnel",
  TRANSFER: "Transfert / Reglement du reste du salaire",
};

export const employeeTransactionStatusLabels: Record<EmployeeTransactionStatus, string> = {
  DRAFT: "Brouillon",
  VALIDATED: "Validee",
  CANCELLED: "Annulee",
};

export function formatPayrollPeriod(payrollYear: number, payrollMonth: number) {
  return new Intl.DateTimeFormat("fr-FR", {
    month: "long",
    year: "numeric",
  }).format(new Date(payrollYear, payrollMonth - 1, 1));
}

export function periodInputToParts(value: string) {
  const [yearText, monthText] = value.split("-");
  return {
    payrollYear: Number(yearText),
    payrollMonth: Number(monthText),
  };
}

export function partsToPeriodInput(payrollYear: number, payrollMonth: number) {
  return `${payrollYear}-${String(payrollMonth).padStart(2, "0")}`;
}
