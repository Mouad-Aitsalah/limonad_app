import { NextResponse } from "next/server";

import { CUSTOMER_ORDER_STATUS_LABELS, type CustomerOrderStatusValue } from "@/lib/client-portal-rules";
import { listCustomerOrders } from "@/lib/server/customer-orders";

import { customerOrderErrorResponse } from "./shared";
import { rejectDisabledModule } from "@/lib/server/module-guard";

/** GET /api/customer-orders?status=&cursor= - the organisation's online orders (staff). */
export async function GET(request: Request) {
  const moduleRejection = await rejectDisabledModule(request);
  if (moduleRejection) return moduleRejection;
  try {
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const page = await listCustomerOrders({
      status: status && status in CUSTOMER_ORDER_STATUS_LABELS ? (status as CustomerOrderStatusValue) : null,
      cursor: url.searchParams.get("cursor"),
    });
    return NextResponse.json(page);
  } catch (error) {
    return customerOrderErrorResponse(error, "Impossible de charger les commandes en ligne.");
  }
}
