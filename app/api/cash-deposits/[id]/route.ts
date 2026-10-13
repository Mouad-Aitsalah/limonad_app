import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { getCashDepositById, mapCashDepositError } from "@/lib/server/cash-deposits";
import { OperationsServiceError } from "@/lib/server/depots";
import { rejectDisabledModule } from "@/lib/server/module-guard";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const moduleRejection = await rejectDisabledModule(request);
  if (moduleRejection) return moduleRejection;
  const { id } = await context.params;
  try {
    return NextResponse.json({ deposit: await getCashDepositById(id) });
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    if (error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    const mapped = mapCashDepositError(error);
    return NextResponse.json({ message: mapped.message }, { status: mapped.status });
  }
}
