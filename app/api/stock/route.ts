import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { getStockLevels, getStockSummary } from "@/lib/server/stock-levels";

export async function GET() {
  try {
    const [levels, summary] = await Promise.all([
      getStockLevels(),
      getStockSummary(),
    ]);
    return NextResponse.json({ levels, summary });
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { message: "Impossible de charger le stock." },
      { status: 500 },
    );
  }
}
