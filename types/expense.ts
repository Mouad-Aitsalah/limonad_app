export type ExpenseStatus = "DRAFT" | "VALIDATED" | "CANCELLED";

export type ExpenseDto = {
  id: string;
  expenseNumber: string;
  expenseAccountId: string;
  expenseAccountName: string;
  date: string;
  description: string;
  supplierId: string | null;
  supplierName: string | null;
  amountHT: number;
  taxAmount: number;
  amountTTC: number;
  method: string | null;
  reference: string | null;
  note: string | null;
  status: ExpenseStatus;
  createdByUserId: string;
  createdByUserName: string;
  validatedByUserId: string | null;
  validatedByUserName: string | null;
  validatedAt: string | null;
  cancelledByUserId: string | null;
  cancelledByUserName: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExpenseMutationInput = {
  expenseAccountId: string;
  date: string;
  description: string;
  supplierId?: string | null;
  amountHT: number;
  taxAmount?: number;
  method?: string | null;
  reference?: string | null;
  note?: string | null;
  idempotencyKey?: string | null;
};

export type ExpensesPageParams = {
  cursor?: string | null;
  pageSize?: number;
  status?: string;
  expenseAccountId?: string;
  dateFrom?: string;
  dateTo?: string;
};

export type ExpensesPageDto = {
  items: ExpenseDto[];
  nextCursor: string | null;
  hasMore: boolean;
  totalCount: number;
};
