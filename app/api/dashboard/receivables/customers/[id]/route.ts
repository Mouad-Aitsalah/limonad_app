import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { getCustomerReceivableDetail } from "@/lib/server/receivables";
import { ReceivablesError } from "@/lib/server/receivables-core";

type RouteContext = { params: Promise<{ id: string }> };

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * GET /api/dashboard/receivables/customers/[id] - the movements behind one
 * customer's balance. Admin only; a customer of another organisation (or an
 * unknown id) is a 404, exactly like a missing one. Read only.
 */
export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    if (!ID_RE.test(id)) throw new ReceivablesError("Client introuvable.", 404);
    return NextResponse.json(await getCustomerReceivableDetail(id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof ReceivablesError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json({ message: "Impossible de charger le compte du client." }, { status: 500 });
  }
}
