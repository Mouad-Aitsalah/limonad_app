import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { getDrivingRouteForCurrentDriver } from "@/lib/server/google-routes";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    return NextResponse.json({
      route: await getDrivingRouteForCurrentDriver(payload),
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { message: "Destination invalide pour l'itineraire." },
        { status: 422 },
      );
    }

    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { message: "Impossible de calculer l'itineraire." },
      { status: 500 },
    );
  }
}
