import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { recordCurrentDriverLocation } from "@/lib/server/driver-tour";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";

export async function POST(request: Request) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  try {
    const payload = await request.json();
    const { currentTour, point } = await recordCurrentDriverLocation(payload);

    return NextResponse.json({ currentTour, point });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { message: "Impossible d'enregistrer la position GPS." },
      { status: 500 },
    );
  }
}
