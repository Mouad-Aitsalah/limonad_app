import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import {
  createCashDeposit,
  getCashDepositHistory,
  mapCashDepositError,
} from "@/lib/server/cash-deposits";
import { OperationsServiceError } from "@/lib/server/depots";
import type { CashDepositHistoryFilters, CashDepositStatus } from "@/types/cash-deposits";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const filters: CashDepositHistoryFilters = {
      search: searchParams.get("search") ?? undefined,
      dateFrom: searchParams.get("dateFrom") ?? undefined,
      dateTo: searchParams.get("dateTo") ?? undefined,
      depotId: searchParams.get("depotId") ?? undefined,
      userId: searchParams.get("userId") ?? undefined,
      status: (searchParams.get("status") as CashDepositStatus | null) ?? undefined,
    };
    return NextResponse.json({ deposits: await getCashDepositHistory(filters) });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    return NextResponse.json(await createCashDeposit(body), { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}

function handleError(error: unknown) {
  if (error instanceof AuthServiceError) {
    return NextResponse.json({ message: error.message }, { status: error.status });
  }
  if (error instanceof OperationsServiceError) {
    return NextResponse.json(
      { message: error.message, fieldErrors: error.fieldErrors },
      { status: error.status },
    );
  }
  const mapped = mapCashDepositError(error);
  return NextResponse.json({ message: mapped.message }, { status: mapped.status });
}
