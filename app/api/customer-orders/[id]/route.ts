import { NextResponse } from "next/server";

import { getCustomerOrderDetail } from "@/lib/server/customer-orders";

import { customerOrderErrorResponse } from "../shared";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/customer-orders/[id] - one online order with its lines (staff). */
export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    return NextResponse.json({ order: await getCustomerOrderDetail(id) });
  } catch (error) {
    return customerOrderErrorResponse(error, "Impossible de charger la commande.");
  }
}
