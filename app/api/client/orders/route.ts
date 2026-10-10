import { NextResponse } from "next/server";

import { clientIpFromHeaders, formatCustomerOrderNumber } from "@/lib/client-portal-rules";
import { prisma } from "@/lib/prisma";
import { ClientAuthError, requireClient } from "@/lib/server/client-auth";
import { ClientPortalError, listClientOrders, submitClientOrder } from "@/lib/server/client-portal-core";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { DocumentType, reserveDocumentSequence } from "@/lib/server/document-sequence";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof ClientAuthError) {
    return NextResponse.json({ message: error.message }, { status: error.status });
  }
  if (error instanceof ClientPortalError) {
    return NextResponse.json(
      { message: error.message, code: error.code, ...(error.details ?? {}) },
      { status: error.status },
    );
  }
  console.error("Erreur commandes Espace Client :", error);
  return NextResponse.json({ message: fallback }, { status: 500 });
}

/**
 * POST /api/client/orders - sends the cart as a customer order (status
 * SUBMITTED, waiting for the staff). The body only carries
 * {lines: [{productId, quantity}], note?, idempotencyKey, expectedTotalTTC?}:
 * the organisation and the customer come from the verified session, every
 * product and price is re-validated server-side. Never creates a sale,
 * payment, stock movement or accounting entry.
 */
export async function POST(request: Request) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;

  try {
    const client = await requireClient();
    const body = await request.json().catch(() => null);
    const result = await submitClientOrder(
      {
        db: prisma,
        nextOrderNumber: async (tx, organizationId) =>
          formatCustomerOrderNumber(await reserveDocumentSequence(tx, organizationId, DocumentType.CustomerOrder)),
      },
      { organizationId: client.organizationId, customerId: client.customerId, contactPhone: client.contactPhone },
      body,
      { ip: clientIpFromHeaders(request.headers) },
    );
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return errorResponse(error, "Impossible d'envoyer la commande.");
  }
}

/** GET /api/client/orders - the connected customer's own recent orders. */
export async function GET() {
  try {
    const client = await requireClient();
    const orders = await listClientOrders(prisma, client);
    return NextResponse.json({ orders });
  } catch (error) {
    return errorResponse(error, "Impossible de charger vos commandes.");
  }
}
