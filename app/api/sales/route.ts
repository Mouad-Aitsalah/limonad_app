import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { createCounterSale } from "@/lib/server/counter-sales";
import { OperationsServiceError } from "@/lib/server/depots";
import { getAllSales } from "@/lib/server/driver-sales";

export async function GET() {
  try {
    return NextResponse.json({ sales: await getAllSales() });
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
      { sale: await createCounterSale(await request.json()) },
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
    return NextResponse.json({ message: "Impossible d'enregistrer la vente." }, { status: 500 });
  }
}
