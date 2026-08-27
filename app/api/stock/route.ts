import { NextResponse } from "next/server";

import { getStockLevels, getStockSummary } from "@/lib/server/stock-levels";

export async function GET() {
  try {
    const [levels, summary] = await Promise.all([
      getStockLevels(),
      getStockSummary(),
    ]);
    return NextResponse.json({ levels, summary });
  } catch {
    return NextResponse.json(
      { message: "Impossible de charger le stock." },
      { status: 500 },
    );
  }
}
