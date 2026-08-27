import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { markCurrentDriverTourReturned } from "@/lib/server/tours";

export async function POST() {
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
