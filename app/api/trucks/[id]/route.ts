import { NextResponse } from "next/server";

import { OperationsServiceError } from "@/lib/server/depots";
import { getTruckById, updateTruck } from "@/lib/server/trucks";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    return NextResponse.json({ truck: await getTruckById(id) });
  } catch (error) {
    if (error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de charger le camion." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  const { id } = await context.params;
  try {
    const truck = await updateTruck(id, await request.json());
    return NextResponse.json({ truck });
  } catch (error) {
    if (error instanceof OperationsServiceError) {
      return NextResponse.json(
        { message: error.message, fieldErrors: error.fieldErrors },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { message: "Impossible de modifier le camion." },
      { status: 500 },
    );
  }
}
