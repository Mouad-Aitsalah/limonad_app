import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { markCurrentDriverTourReturned } from "@/lib/server/tours";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { reportUnexpected } from "@/lib/server/report-error";

export async function POST(request: Request) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  try {
    return NextResponse.json({ tour: await markCurrentDriverTourReturned() });
  } catch (error) {
    reportUnexpected(error, {
      route: "POST /api/driver/tour/return",
      area: "driver-tours",
      op: "returnTour",
    });
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible d'enregistrer le retour." },
      { status: 500 },
    );
  }
}
