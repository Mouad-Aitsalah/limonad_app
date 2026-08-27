import { NextResponse } from "next/server";

import { getSuppliers } from "@/lib/server/suppliers";

export async function GET() {
  try {
    return NextResponse.json({ suppliers: await getSuppliers() });
  } catch {
    return NextResponse.json(
      { message: "Impossible de charger les fournisseurs." },
      { status: 500 },
    );
  }
}
