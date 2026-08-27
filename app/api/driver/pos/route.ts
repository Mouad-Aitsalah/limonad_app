import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { getDriverPosContext } from "@/lib/server/driver-sales";

export async function GET() {
  try {
    return NextResponse.json({ context: await getDriverPosContext() });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json({ message: "Impossible de charger le POS." }, { status: 500 });
  }
}
