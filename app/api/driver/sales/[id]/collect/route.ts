import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { OperationsServiceError } from "@/lib/server/depots";
import { collectDriverSale } from "@/lib/server/pending-sales";
import { reportUnexpected } from "@/lib/server/report-error";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/driver/sales/[id]/collect - see /api/sales/[id]/collect. Scoped
 * to the signed-in driver's own DRAFT truck sales; idempotent.
 */
export async function POST(request: Request, context: RouteContext) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  const { id } = await context.params;
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({ sale: await collectDriverSale(id, body) });
  } catch (error) {
    reportUnexpected(error, {
      route: "POST /api/driver/sales/[id]/collect",
      area: "sales",
      op: "collectDriverSale",
    });
    if (error instanceof AuthServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    if (error instanceof OperationsServiceError) {
      return NextResponse.json(
        { message: error.message, fieldErrors: error.fieldErrors },
        { status: error.status },
      );
    }
    return NextResponse.json({ message: "Impossible d'encaisser la facture." }, { status: 500 });
  }
}
