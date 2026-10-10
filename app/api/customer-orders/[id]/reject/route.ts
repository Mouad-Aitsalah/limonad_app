import { NextResponse } from "next/server";
import { z } from "zod";

import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { transitionCustomerOrder } from "@/lib/server/customer-orders";

import { customerOrderErrorResponse } from "../../shared";

type RouteContext = { params: Promise<{ id: string }> };

const bodySchema = z.object({ reason: z.string().trim().max(500).optional() });

/** POST /api/customer-orders/[id]/reject - SUBMITTED/ACCEPTED -> REJECTED, optional reason. */
export async function POST(request: Request, context: RouteContext) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  const { id } = await context.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ message: "Le motif est invalide." }, { status: 422 });
  }
  try {
    return NextResponse.json({ order: await transitionCustomerOrder(id, "REJECTED", parsed.data.reason) });
  } catch (error) {
    return customerOrderErrorResponse(error, "Impossible de refuser la commande.");
  }
}
