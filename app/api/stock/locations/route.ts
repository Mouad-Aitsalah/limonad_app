import { NextResponse } from "next/server";

import { getStockLocations } from "@/lib/server/stock-locations";
import { rejectDisabledModule } from "@/lib/server/module-guard";

export async function GET(request: Request) {
  const moduleRejection = await rejectDisabledModule(request);
  if (moduleRejection) return moduleRejection;
  try {
    return NextResponse.json({ locations: await getStockLocations() });
  } catch {
    return NextResponse.json(
      { message: "Impossible de charger les emplacements." },
      { status: 500 },
    );
  }
}
