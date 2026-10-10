import { NextResponse } from "next/server";

import { getCustomerOrderForPos } from "@/lib/server/customer-orders";

import { customerOrderErrorResponse } from "../../shared";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/customer-orders/[id]/pos - an ACCEPTED order re-validated for the
 * POS cart (products + customer). Read-only: nothing is created and the
 * order stays ACCEPTED until the POS sale links it.
 */
export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    return NextResponse.json({ order: await getCustomerOrderForPos(id) });
  } catch (error) {
    return customerOrderErrorResponse(error, "Impossible d'ouvrir la commande dans le POS.");
  }
}
