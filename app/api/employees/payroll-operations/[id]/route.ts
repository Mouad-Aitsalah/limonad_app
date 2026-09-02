import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import {
  cancelEmployeeTransaction,
  mapEmployeeTransactionError,
  validateEmployeeTransaction,
} from "@/lib/server/employee-transactions";
import { OperationsServiceError } from "@/lib/server/depots";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  const { id } = await context.params;
  try {
    const body = (await request.json()) as { action?: "validate" | "cancel" };

    if (body.action === "cancel") {
      return NextResponse.json({ transaction: await cancelEmployeeTransaction(id) });
    }

    return NextResponse.json({ transaction: await validateEmployeeTransaction(id) });
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
