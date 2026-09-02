import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { markCurrentDriverTourReturned } from "@/lib/server/tours";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";

export async function POST(request: Request) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  try {
    return NextResponse.json({ tour: await markCurrentDriverTourReturned() });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible d'enregistrer le retour." },
      { status: 500 },
    );
  }
}
