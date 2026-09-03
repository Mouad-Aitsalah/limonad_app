import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { OperationsServiceError } from "@/lib/server/depots";
import { collectCounterSale } from "@/lib/server/pending-sales";
import { reportUnexpected } from "@/lib/server/report-error";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/sales/[id]/collect
 * Encaisse une facture du jour (status DRAFT -> PAID/PARTIALLY_PAID/CREDIT):
 * enregistre le paiement, attribue le numéro officiel, poste l'écriture
 * comptable. Idempotent - un second appel sur une facture déjà encaissée
 * renvoie la facture inchangée.
 */
export async function POST(request: Request, context: RouteContext) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  const { id } = await context.params;
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({ sale: await collectCounterSale(id, body) });
  } catch (error) {
    reportUnexpected(error, {
      route: "POST /api/sales/[id]/collect",
      area: "sales",
      op: "collectCounterSale",
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
