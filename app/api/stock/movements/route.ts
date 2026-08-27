import { NextResponse } from "next/server";

import { getStockMovements } from "@/lib/server/stock-movements";

export async function GET() {
  try {
    return NextResponse.json({ movements: await getStockMovements() });
  } catch {
    return NextResponse.json(
      { message: "Impossible de charger les mouvements." },
      { status: 500 },
    );
  }
}
