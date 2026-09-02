import { NextResponse } from "next/server";

import { getBrands } from "@/lib/server/brands";
import { reportUnexpected } from "@/lib/server/report-error";

export async function GET() {
  try {
    return NextResponse.json({ brands: await getBrands() });
  } catch (error) {
    reportUnexpected(error, { route: "GET /api/brands" });
    return NextResponse.json(
      { message: "Impossible de charger les marques." },
      { status: 500 },
    );
  }
}
