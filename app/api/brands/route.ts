import { NextResponse } from "next/server";

import { getBrands } from "@/lib/server/brands";

export async function GET() {
  try {
    return NextResponse.json({ brands: await getBrands() });
  } catch {
    return NextResponse.json(
      { message: "Impossible de charger les marques." },
      { status: 500 },
    );
  }
}
