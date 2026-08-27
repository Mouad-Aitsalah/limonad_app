import { NextResponse } from "next/server";

import { OperationsServiceError } from "@/lib/server/depots";
import { createStockAdjustment } from "@/lib/server/stock-movements";

export async function POST(request: Request) {
  try {
    const result = await createStockAdjustment(await request.json());
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof OperationsServiceError) {
      return NextResponse.json(
        { message: error.message, fieldErrors: error.fieldErrors },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { message: "Impossible de creer l'ajustement." },
      { status: 500 },
    );
  }
}
