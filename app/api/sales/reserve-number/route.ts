import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { reserveCounterSaleNumber } from "@/lib/server/counter-sales";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { OperationsServiceError } from "@/lib/server/depots";

/**
 * POST /api/sales/reserve-number
 * Reserves the next commercial Sale number ("N/YYYY") for a brand-new POS
 * invoice tab, before any product is added. The number is spent immediately
 * and never recycled - see reserveCounterSaleNumber.
 */
export async function POST(request: Request) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  try {
    return NextResponse.json(
      { reservation: await reserveCounterSaleNumber() },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de réserver le numéro de facture." },
      { status: 500 },
    );
  }
}
