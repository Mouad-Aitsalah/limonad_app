import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { getPosProductsByIds } from "@/lib/server/products";

/**
 * GET /api/products/pos-by-ids?locationId=...&ids=a,b,c - the POS products
 * (DriverPosProductDto, stock at `locationId`) for explicit ids. The POS calls
 * it for cart lines whose product was not in its preloaded context (see
 * getPosProductsByIds), so such a line is resolved instead of disappearing.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const locationId = url.searchParams.get("locationId") ?? "";
    const ids = (url.searchParams.get("ids") ?? "").split(",");
    if (!locationId) {
      return NextResponse.json({ message: "Emplacement manquant." }, { status: 400 });
    }

    const products = await getPosProductsByIds({ locationId, ids });
    return NextResponse.json({ products });
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json({ message: "Impossible de charger les produits." }, { status: 500 });
  }
}
