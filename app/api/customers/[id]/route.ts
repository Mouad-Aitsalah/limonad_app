import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { getCustomerById, updateCustomer } from "@/lib/server/customers";
import { OperationsServiceError } from "@/lib/server/depots";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    return NextResponse.json({ customer: await getCustomerById(id) });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json({ message: "Impossible de charger le client." }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  const { id } = await context.params;
  try {
    return NextResponse.json({ customer: await updateCustomer(id, await request.json()) });
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
    return NextResponse.json({ message: "Impossible de modifier le client." }, { status: 500 });
  }
}
