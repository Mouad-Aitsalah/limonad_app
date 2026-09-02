import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { markCurrentDriverNoSale } from "@/lib/server/driver-tour";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";

export async function POST(
  request: Request,
  context: { params: Promise<{ customerId: string }> },
) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  try {
    const { customerId } = await context.params;
    const payload = await request.json();

    return NextResponse.json({
      currentTour: await markCurrentDriverNoSale(customerId, payload),
    });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { message: "Impossible d'enregistrer l'absence de vente." },
      { status: 500 },
    );
  }
}
