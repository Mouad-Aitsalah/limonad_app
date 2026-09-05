import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import {
  getCustomerDebt,
  getCustomerSettlements,
  recordCustomerSettlement,
} from "@/lib/server/customer-settlements";
import { OperationsServiceError } from "@/lib/server/depots";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const [debt, settlements] = await Promise.all([
      getCustomerDebt(id),
      getCustomerSettlements(id),
    ]);
    return NextResponse.json({ debt, settlements });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json({ message: "Impossible de charger le solde du client." }, { status: 500 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  const { id } = await context.params;
  try {
    return NextResponse.json(
      { settlement: await recordCustomerSettlement(id, await request.json()) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    if (error instanceof OperationsServiceError) {
      return NextResponse.json(
        { message: error.message, fieldErrors: error.fieldErrors },
        { status: error.status },
      );
    }
    return NextResponse.json({ message: "Impossible d'enregistrer le reglement." }, { status: 500 });
  }
}
