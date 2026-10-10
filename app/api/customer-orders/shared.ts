import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { CustomerOrderError } from "@/lib/server/customer-orders";
import { OperationsServiceError } from "@/lib/server/depots";

/** Shared error mapping of the /api/customer-orders/* routes. */
export function customerOrderErrorResponse(error: unknown, fallback: string) {
  if (
    error instanceof AuthServiceError ||
    error instanceof CustomerOrderError ||
    error instanceof OperationsServiceError
  ) {
    return NextResponse.json({ message: error.message }, { status: error.status });
  }
  console.error("Erreur commandes en ligne :", error);
  return NextResponse.json({ message: fallback }, { status: 500 });
}
