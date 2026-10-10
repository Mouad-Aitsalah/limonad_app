import { NextResponse } from "next/server";

import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { transitionCustomerOrder } from "@/lib/server/customer-orders";

import { customerOrderErrorResponse } from "../../shared";

type RouteContext = { params: Promise<{ id: string }> };

/** POST /api/customer-orders/[id]/accept - SUBMITTED -> ACCEPTED. Status only: no sale, no stock. */
export async function POST(request: Request, context: RouteContext) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  const { id } = await context.params;
  try {
    return NextResponse.json({ order: await transitionCustomerOrder(id, "ACCEPTED") });
  } catch (error) {
    return customerOrderErrorResponse(error, "Impossible d'accepter la commande.");
  }
}
