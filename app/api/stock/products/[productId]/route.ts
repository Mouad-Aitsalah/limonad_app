import { NextResponse } from "next/server";

import { getStockLevelsByProduct } from "@/lib/server/stock-levels";

type RouteContext = { params: Promise<{ productId: string }> };

export async function GET(_request: Request, context: RouteContext) {
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
