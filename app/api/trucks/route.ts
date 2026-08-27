import { NextResponse } from "next/server";

import { OperationsServiceError } from "@/lib/server/depots";
import { createTruck, getTrucks } from "@/lib/server/trucks";

export async function GET() {
  try {
    return NextResponse.json({ trucks: await getTrucks() });
  } catch {
    return NextResponse.json(
      { message: "Impossible de charger les camions." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const truck = await createTruck(await request.json());
    return NextResponse.json({ truck }, { status: 201 });
  } catch (error) {
    if (error instanceof OperationsServiceError) {
      return NextResponse.json(
        { message: error.message, fieldErrors: error.fieldErrors },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { message: "Impossible de creer le camion." },
      { status: 500 },
    );
  }
}
