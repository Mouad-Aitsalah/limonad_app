import type { AccountingAccountOptionDto } from "@/types/accounting";

export type BusinessAccountType =
  | "CUSTOMER"
  | "SUPPLIER"
  | "EXPENSE"
  | "TREASURY";

export type BusinessAccountListType = BusinessAccountType | "EMPLOYEE";

export type TreasuryBusinessAccountKind = "CASH" | "BANK";

export type BusinessAccountStatus = "ACTIVE" | "INACTIVE" | "BLOCKED";

export type BusinessAccountListItem = {
  id: string;
  sourceId: string;
  accountNumber: string;
  name: string;
  type: BusinessAccountListType;
  phone: string | null;
  creditLimit: number | null;
  createdAt: string;
  email?: string | null;
  city?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  status: BusinessAccountStatus;
};

export type BusinessAccountsSummaryDto = {
  totalCount: number;
  customerCount: number;
  supplierCount: number;
  expenseCount: number;
  treasuryCount: number;
  employeeCount: number;
};

export type BusinessAccountsPayload = {
  items: BusinessAccountListItem[];
  summary: BusinessAccountsSummaryDto;
};

export type BusinessAccountInput = {
  type: BusinessAccountType;
  code?: string | null;
  name: string;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  creditLimit?: number;
  balance?: number;
  status?: BusinessAccountStatus;
  ice?: string | null;
  taxId?: string | null;
  description?: string | null;
  category?: string | null;
  treasuryKind?: TreasuryBusinessAccountKind | null;
  accountingAccountId?: string | null;
};

export type BusinessAccountFormOptions = {
  accountingAccounts: AccountingAccountOptionDto[];
};
