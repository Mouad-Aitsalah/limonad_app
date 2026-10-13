import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { getCounterPosContext } from "@/lib/server/counter-sales";
import { OperationsServiceError } from "@/lib/server/depots";
import { rejectDisabledModule } from "@/lib/server/module-guard";

export async function GET(request: Request) {
  const moduleRejection = await rejectDisabledModule(request);
  if (moduleRejection) return moduleRejection;
  try {
    return NextResponse.json({ context: await getCounterPosContext() });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de charger le contexte du point de vente." },
      { status: 500 },
    );
  }
}
