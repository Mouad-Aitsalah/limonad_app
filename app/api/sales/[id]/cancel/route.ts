import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { OperationsServiceError } from "@/lib/server/depots";
import { reportUnexpected } from "@/lib/server/report-error";
import { cancelSale } from "@/lib/server/sale-admin";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/sales/[id]/cancel
 * Annulation métier d'une facture (admin / super_admin uniquement).
 * Restaure le stock, contre-passe les écritures comptables, remet à zéro
 * les paiements et la dette client, puis passe la Sale en CANCELLED en
 * conservant son numéro. Jamais de suppression physique. Atomique.
 */
export async function POST(request: Request, context: RouteContext) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  const { id } = await context.params;
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({ sale: await cancelSale(id, body) });
  } catch (error) {
    reportUnexpected(error, {
      route: "POST /api/sales/[id]/cancel",
      area: "sales",
      op: "cancelSale",
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
      { message: "Impossible d'annuler la facture." },
      { status: 500 },
    );
  }
}
