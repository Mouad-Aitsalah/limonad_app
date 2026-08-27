import { NextResponse } from "next/server";

import { AuthServiceError, requireSessionUser } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { createTour, getTours } from "@/lib/server/tours";

export async function GET() {
  try {
    await requireSessionUser(["admin", "depot_manager"]);
    return NextResponse.json({ tours: await getTours() });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de charger les tournees." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const tour = await createTour(await request.json());
    return NextResponse.json({ tour }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    if (error instanceof OperationsServiceError) return serviceErrorResponse(error);
    return NextResponse.json(
      { message: "Impossible de creer la tournee." },
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
