import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { getOpenLoadingForTruck } from "@/lib/server/truck-loadings";

export async function GET(request: Request) {
  const truckId = new URL(request.url).searchParams.get("truckId");
  if (!truckId) {
    return NextResponse.json({ message: "Le camion est obligatoire." }, { status: 422 });
  }

  try {
    return NextResponse.json({ loading: await getOpenLoadingForTruck(truckId) });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de charger la fiche ouverte." },
      { status: 500 },
    );
  }
}
