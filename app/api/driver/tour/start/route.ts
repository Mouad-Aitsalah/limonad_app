import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { createAndStartTourForCurrentDriver } from "@/lib/server/tours";

export async function POST() {
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
