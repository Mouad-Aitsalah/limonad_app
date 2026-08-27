import { NextResponse } from "next/server";

import { AuthServiceError, requireSessionUser } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { getTourById, updateDraftTour } from "@/lib/server/tours";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    await requireSessionUser(["admin", "depot_manager"]);
    return NextResponse.json({ tour: await getTourById(id) });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de charger la tournee." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    return NextResponse.json({ tour: await updateDraftTour(id, await request.json()) });
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    if (error instanceof OperationsServiceError) return serviceErrorResponse(error);
    return NextResponse.json(
      { message: "Impossible de modifier la tournee." },
      { status: 500 },
    );
  }
}

function serviceErrorResponse(error: OperationsServiceError) {
  return NextResponse.json(
    { message: error.message, fieldErrors: error.fieldErrors },
    { status: error.status },
  );
}
