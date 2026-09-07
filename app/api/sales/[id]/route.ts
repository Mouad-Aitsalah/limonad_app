import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { OperationsServiceError } from "@/lib/server/depots";
import { getSaleById } from "@/lib/server/driver-sales";
import { reportUnexpected } from "@/lib/server/report-error";
import { reviseSale } from "@/lib/server/sale-admin";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    return NextResponse.json({ sale: await getSaleById(id) });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json({ message: "Impossible de charger la vente." }, { status: 500 });
  }
}

/**
 * PATCH /api/sales/[id]
 * Modification métier d'une facture comptoir (admin / super_admin).
 * Même numéro conservé ; stock en delta, paiements et écritures comptables
 * contre-passés puis réémis, dette client recalculée. Atomique.
 */
export async function PATCH(request: Request, context: RouteContext) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  const { id } = await context.params;
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({ sale: await reviseSale(id, body) });
  } catch (error) {
    reportUnexpected(error, {
      route: "PATCH /api/sales/[id]",
      area: "sales",
      op: "reviseSale",
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
    return NextResponse.json(
      { message: "Impossible d'enregistrer les modifications." },
      { status: 500 },
    );
  }
}
