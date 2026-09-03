import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { resolveCustomerByNumber } from "@/lib/server/customers";
import { OperationsServiceError } from "@/lib/server/depots";

/**
 * GET /api/customers/by-number?n=15
 *
 * POS "N° client" box: resolves a short number ("1", "15", "125"), a full
 * "3421/15" or a raw "342115" to the one customer it can be, scoped to the
 * caller's organisation (and driver visibility for a driver session). A
 * number that doesn't exist here returns a clean 404, never a 500.
 */
export async function GET(request: Request) {
  const n = new URL(request.url).searchParams.get("n") ?? "";
  try {
    const customer = await resolveCustomerByNumber(n);
    if (!customer) {
      return NextResponse.json({ message: "Client introuvable." }, { status: 404 });
    }
    return NextResponse.json({ customer });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de rechercher le client." },
      { status: 500 },
    );
  }
}
