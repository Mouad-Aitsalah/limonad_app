import { NextResponse } from "next/server";

import { getCustomerOrderDetail } from "@/lib/server/customer-orders";

import { customerOrderErrorResponse } from "../shared";
import { rejectDisabledModule } from "@/lib/server/module-guard";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/customer-orders/[id] - one online order with its lines (staff). */
export async function GET(request: Request, context: RouteContext) {
  const moduleRejection = await rejectDisabledModule(request);
  if (moduleRejection) return moduleRejection;
  const { id } = await context.params;
  try {
    return NextResponse.json({ order: await getCustomerOrderDetail(id) });
  } catch (error) {
    return customerOrderErrorResponse(error, "Impossible de charger la commande.");
  }
}
