import { NextResponse } from "next/server";

import { getStockLocations } from "@/lib/server/stock-locations";

export async function GET() {
  try {
    return NextResponse.json({ locations: await getStockLocations() });
  } catch {
    return NextResponse.json(
      { message: "Impossible de charger les emplacements." },
      { status: 500 },
    );
  }
}
