import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { getCounterPosContext } from "@/lib/server/counter-sales";
import { OperationsServiceError } from "@/lib/server/depots";

export async function GET() {
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
