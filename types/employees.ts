export type EmployeeStatus = "ACTIVE" | "INACTIVE";

export type EmployeeTransactionType =
  | "ADVANCE"
  | "REMUNERATION_PERSONNEL"
  | "TRANSFER";

export type EmployeeTransactionStatus = "DRAFT" | "VALIDATED" | "CANCELLED";

export type EmployeeAccountRefDto = {
  id: string;
  code: string;
  name: string;
};

export type EmployeeDto = {
  id: string;
  employeeCode: string;
  fullName: string;
  hireDate: string | null;
  salary: number | null;
  phone: string | null;
  advanceAccount: EmployeeAccountRefDto | null;
  salaryAccount: EmployeeAccountRefDto | null;
  status: EmployeeStatus;
  createdAt: string;
  updatedAt: string;
};

export type EmployeeOptionDto = {
  id: string;
  employeeCode: string;
  fullName: string;
  salary: number | null;
  status: EmployeeStatus;
  advanceAccount: EmployeeAccountRefDto | null;
  salaryAccount: EmployeeAccountRefDto | null;
};

export type EmployeesSummaryDto = {
  totalCount: number;
  activeCount: number;
  monthlyPayroll: number;
  monthlyAdvances: number;
};

export type EmployeesPayload = {
  items: EmployeeDto[];
  summary: EmployeesSummaryDto;
};

export type EmployeeInput = {
  employeeCode: string;
  fullName: string;
  hireDate?: string | null;
  salary?: number | null;
  phone?: string | null;
  advanceAccountCode: string;
  salaryAccountCode: string;
  status?: EmployeeStatus;
};

export type EmployeePayrollContextDto = {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  payrollYear: number;
  payrollMonth: number;
  salary: number;
  remunerationTotal: number;
  advanceTotal: number;
  transferredTotal: number;
  remainingSalary: number;
  paidAmount: number;
  isSettled: boolean;
  advanceAccount: EmployeeAccountRefDto | null;
  salaryAccount: EmployeeAccountRefDto | null;
};

export type EmployeeTransactionDto = {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  number: string;
  transactionDate: string;
  payrollYear: number;
  payrollMonth: number;
  type: EmployeeTransactionType;
  amount: number;
  status: EmployeeTransactionStatus;
  comment: string | null;
  accountingEntryId: string | null;
  accountingEntryNumber: string | null;
  createdByUserId: string;
  createdByUserName: string;
  validatedAt: string | null;
  validatedByUserId: string | null;
  validatedByUserName: string | null;
  cancelledAt: string | null;
  cancelledByUserId: string | null;
  cancelledByUserName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EmployeeTransactionInput = {
  employeeId: string;
  transactionDate: string;
  payrollYear: number;
  payrollMonth: number;
  type: EmployeeTransactionType;
  amount: number;
  comment?: string | null;
  status?: EmployeeTransactionStatus;
  idempotencyKey?: string | null;
};

export type EmployeeTransactionFilters = {
  employeeId?: string | null;
  payrollYear?: number | null;
  payrollMonth?: number | null;
  status?: EmployeeTransactionStatus | null;
  type?: EmployeeTransactionType | null;
};

export type EmployeeTransactionsPayload = {
  items: EmployeeTransactionDto[];
};

export type EmployeeDetailPayload = {
  employee: EmployeeDto;
  period: EmployeePayrollContextDto;
  history: EmployeeTransactionDto[];
};
