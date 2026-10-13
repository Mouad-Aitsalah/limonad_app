import { NextResponse } from "next/server";

import { getSuppliers } from "@/lib/server/suppliers";
import { rejectDisabledModule } from "@/lib/server/module-guard";

export async function GET(request: Request) {
  const moduleRejection = await rejectDisabledModule(request);
  if (moduleRejection) return moduleRejection;
  try {
    return NextResponse.json({ suppliers: await getSuppliers() });
  } catch {
    return NextResponse.json(
      { message: "Impossible de charger les fournisseurs." },
      { status: 500 },
    );
  }
}
