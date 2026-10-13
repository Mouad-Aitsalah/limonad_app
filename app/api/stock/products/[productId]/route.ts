import { NextResponse } from "next/server";

import { getStockLevelsByProduct } from "@/lib/server/stock-levels";
import { rejectDisabledModule } from "@/lib/server/module-guard";

type RouteContext = { params: Promise<{ productId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const moduleRejection = await rejectDisabledModule(request);
  if (moduleRejection) return moduleRejection;
  const { productId } = await context.params;
  try {
    return NextResponse.json({ levels: await getStockLevelsByProduct(productId) });
  } catch {
    return NextResponse.json(
      { message: "Impossible de charger le stock produit." },
      { status: 500 },
    );
  }
}
