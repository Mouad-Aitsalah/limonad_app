import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import {
  createEmployeeTransaction,
  listEmployeeTransactions,
  mapEmployeeTransactionError,
} from "@/lib/server/employee-transactions";
import { OperationsServiceError } from "@/lib/server/depots";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const payrollYear = Number(url.searchParams.get("payrollYear") ?? "");
  const payrollMonth = Number(url.searchParams.get("payrollMonth") ?? "");

  try {
    return NextResponse.json({
      items: await listEmployeeTransactions({
        employeeId: url.searchParams.get("employeeId"),
        payrollYear: Number.isFinite(payrollYear) ? payrollYear : null,
        payrollMonth: Number.isFinite(payrollMonth) ? payrollMonth : null,
        status: (url.searchParams.get("status") as
          | "DRAFT"
          | "VALIDATED"
          | "CANCELLED"
          | null),
        type: (url.searchParams.get("type") as
          | "ADVANCE"
          | "REMUNERATION_PERSONNEL"
          | "TRANSFER"
          | null),
      }),
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  try {
    const body = await request.json();
    return NextResponse.json(
      { transaction: await createEmployeeTransaction(body) },
      { status: 201 },
    );
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
  const mapped = mapEmployeeTransactionError(error);
  return NextResponse.json(
    { message: mapped.message, fieldErrors: mapped.fieldErrors },
    { status: mapped.status },
  );
}
