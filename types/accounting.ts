export type AccountingAccountType =
  | "ASSET"
  | "LIABILITY"
  | "EQUITY"
  | "REVENUE"
  | "EXPENSE"
  | "TREASURY"
  | "RECEIVABLE"
  | "PAYABLE"
  | "TAX";

export type AccountingEntryStatus = "DRAFT" | "POSTED" | "REVERSED";

export type AccountingJournalType =
  | "GENERAL"
  | "SALES"
  | "PURCHASES"
  | "TREASURY"
  | "CREDIT_NOTES"
  | "MANUAL";

export type AccountingSourceType =
  | "MANUAL_ENTRY"
  | "SALE"
  | "CUSTOMER_CREDIT_NOTE"
  | "SUPPLIER_CREDIT_NOTE"
  | "PURCHASE"
  | "CUSTOMER_PAYMENT"
  | "SUPPLIER_PAYMENT"
  | "EMPLOYEE_ADVANCE"
  | "EMPLOYEE_REMUNERATION"
  | "EMPLOYEE_TRANSFER";

export type AccountingStampCalculationMethod =
  | "FIXED_AMOUNT"
  | "PERCENTAGE_OF_TOTAL_TTC";

export type AccountingAccountDto = {
  id: string;
  code: string;
  name: string;
  type: AccountingAccountType;
  isActive: boolean;
  movementCount: number;
  createdAt: string;
  updatedAt: string;
};

export type AccountingAccountOptionDto = {
  id: string;
  code: string;
  name: string;
  type: AccountingAccountType;
  isActive: boolean;
};

export type AccountingEntryLineDto = {
  id: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  operationNumber: number;
  label: string;
  debit: number;
  credit: number;
  position: number;
};

export type AccountingEntryDto = {
  id: string;
  entryNumber: string;
  date: string;
  reference: string | null;
  description: string;
  journalType: AccountingJournalType;
  status: AccountingEntryStatus;
  sourceType: AccountingSourceType | null;
  sourceId: string | null;
  createdByUserId: string | null;
  createdByUserName: string | null;
  totalDebit: number;
  totalCredit: number;
  lines: AccountingEntryLineDto[];
  createdAt: string;
  updatedAt: string;
};

export type AccountingJournalLineDto = {
  id: string;
  entryId: string;
  entryNumber: string;
  operationNumber: number;
  date: string;
  reference: string | null;
  description: string;
  journalType: AccountingJournalType;
  status: AccountingEntryStatus;
  sourceType: AccountingSourceType | null;
  sourceId: string | null;
  createdByUserName: string | null;
  accountId: string;
  accountCode: string;
  accountName: string;
  label: string;
  debit: number;
  credit: number;
  position: number;
  invoiceNumber: string | null;
  checkNumber: string | null;
  partyName: string | null;
};

export type AccountingAccountSettingsKey =
  | "employeePayrollExpenseAccountId"
  | "salesAccountId"
  | "salesVatAccountId"
  | "purchaseAccountId"
  | "purchaseVatAccountId"
  | "cashAccountId"
  | "bankAccountId"
  | "customerAccountId"
  | "supplierAccountId"
  | "customerReturnAccountId"
  | "supplierReturnAccountId"
  | "stampExpenseAccountId"
  | "stampPayableAccountId";

export type AccountingSettingsUpdateInput = {
  employeePayrollExpenseAccountId?: string | null;
  salesAccountId?: string | null;
  salesVatAccountId?: string | null;
  purchaseAccountId?: string | null;
  purchaseVatAccountId?: string | null;
  cashAccountId?: string | null;
  bankAccountId?: string | null;
  customerAccountId?: string | null;
  supplierAccountId?: string | null;
  customerReturnAccountId?: string | null;
  supplierReturnAccountId?: string | null;
  stampEnabled?: boolean;
  stampCalculationMethod?: AccountingStampCalculationMethod;
  stampValue?: number;
  stampExpenseAccountId?: string | null;
  stampPayableAccountId?: string | null;
};

export type AccountingSettingsDto = {
  id: string;
  employeePayrollExpenseAccountId: string | null;
  salesAccountId: string | null;
  salesVatAccountId: string | null;
  purchaseAccountId: string | null;
  purchaseVatAccountId: string | null;
  cashAccountId: string | null;
  bankAccountId: string | null;
  customerAccountId: string | null;
  supplierAccountId: string | null;
  customerReturnAccountId: string | null;
  supplierReturnAccountId: string | null;
  stampEnabled: boolean;
  stampCalculationMethod: AccountingStampCalculationMethod;
  stampValue: number;
  stampExpenseAccountId: string | null;
  stampPayableAccountId: string | null;
  updatedByUserId: string | null;
  updatedByUserName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AccountingAccountInput = {
  code: string;
  name: string;
  type: AccountingAccountType;
  isActive?: boolean;
};

export type ManualAccountingEntryLineInput = {
  accountId: string;
  /** Optional - the line "désignation". Stored verbatim (may be ""). */
  label?: string;
  debit: number | string;
  credit: number | string;
};

export type ManualAccountingEntryInput = {
  date: string;
  reference?: string | null;
  description: string;
  journalType?: AccountingJournalType;
  /** "DRAFT" saves an un-posted brouillon (not shown in the Journal);
   * "POSTED" (default) comptabilises it immediately. */
  status?: "DRAFT" | "POSTED";
  lines: ManualAccountingEntryLineInput[];
};
