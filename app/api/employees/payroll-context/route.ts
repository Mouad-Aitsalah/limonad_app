import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import {
  getEmployeePayrollContext,
  mapEmployeeTransactionError,
} from "@/lib/server/employee-transactions";
import { OperationsServiceError } from "@/lib/server/depots";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const employeeId = url.searchParams.get("employeeId");
  const payrollYear = Number(url.searchParams.get("payrollYear") ?? "");
  const payrollMonth = Number(url.searchParams.get("payrollMonth") ?? "");

  try {
    if (!employeeId) {
      throw new OperationsServiceError("L'employe est obligatoire.", 422);
    }
    return NextResponse.json({
      context: await getEmployeePayrollContext(employeeId, {
        payrollYear: Number.isFinite(payrollYear) ? payrollYear : null,
        payrollMonth: Number.isFinite(payrollMonth) ? payrollMonth : null,
      }),
    });
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
