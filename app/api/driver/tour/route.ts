import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { getCurrentDriverTour } from "@/lib/server/driver-tour";

export async function GET() {
  try {
    return NextResponse.json({ currentTour: await getCurrentDriverTour() });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de charger la tournee chauffeur." },
      { status: 500 },
    );
  }
}
