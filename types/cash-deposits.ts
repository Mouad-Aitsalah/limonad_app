/**
 * Master denomination list for the "Versement de caisse" form. Purely data
 * (no Prisma enum) so a new denomination can be added here without any
 * schema change - CashDepositDenomination.denomination is a free Decimal
 * column, not one column per note/coin.
 */
export const cashDenominations = [0.5, 1, 2, 5, 10, 20, 50, 100, 200] as const;

export type CashDepositStatus = "VALIDATED" | "CANCELLED";

export type CashDepositDenominationDto = {
  denomination: number;
  quantity: number;
  amount: number;
};

export type CashDepositSummaryDto = {
  id: string;
  number: string;
  date: string;
  depotId: string;
  depotName: string;
  posSessionId: string | null;
  posSessionNumber: number | null;
  cashTotal: number;
  checkTotal: number;
  total: number;
  status: CashDepositStatus;
  notes: string | null;
  createdByUserId: string;
  createdByUserName: string;
  createdAt: string;
};

export type CashDepositDto = CashDepositSummaryDto & {
  denominations: CashDepositDenominationDto[];
};

export type CashDepositCreateInput = {
  denominations: Array<{ denomination: number; quantity: number }>;
  checkTotal?: number;
  notes?: string | null;
};

export type CashDepositContextDto = {
  depotId: string;
  depotName: string;
  posSessionId: string | null;
  posSessionNumber: number | null;
  userName: string;
  canFilterByDepot: boolean;
  todayCount: number;
  todayTotal: number;
  todayCashTotal: number;
  todayCheckTotal: number;
};

export type CashDepositHistoryFilters = {
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  depotId?: string;
  userId?: string;
  status?: CashDepositStatus;
};
