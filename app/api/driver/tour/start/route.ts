import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { createAndStartTourForCurrentDriver } from "@/lib/server/tours";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";

export async function POST(request: Request) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  try {
    return NextResponse.json({ tour: await createAndStartTourForCurrentDriver() });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de demarrer la tournee." },
      { status: 500 },
    );
  }
}
