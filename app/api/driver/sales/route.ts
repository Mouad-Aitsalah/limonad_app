import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { createDriverSale, getSalesForCurrentDriver } from "@/lib/server/driver-sales";

export async function GET() {
  try {
    return NextResponse.json({ sales: await getSalesForCurrentDriver() });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json({ message: "Impossible de charger les ventes." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    return NextResponse.json(
      { sale: await createDriverSale(await request.json()) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    if (error instanceof OperationsServiceError) {
      return NextResponse.json(
        { message: error.message, fieldErrors: error.fieldErrors },
        { status: error.status },
      );
    }
    return NextResponse.json({ message: "Impossible de valider la vente." }, { status: 500 });
  }
}
