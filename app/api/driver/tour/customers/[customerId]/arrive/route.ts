import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { confirmCurrentDriverArrival } from "@/lib/server/driver-tour";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";

export async function POST(
  request: Request,
  context: { params: Promise<{ customerId: string }> },
) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  try {
    const { customerId } = await context.params;

    return NextResponse.json({
      currentTour: await confirmCurrentDriverArrival(customerId),
    });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { message: "Impossible de confirmer l'arrivee chez le client." },
      { status: 500 },
    );
  }
}
