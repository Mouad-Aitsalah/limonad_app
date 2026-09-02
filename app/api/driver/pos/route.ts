import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { getDriverPosContext } from "@/lib/server/driver-sales";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const customerId = url.searchParams.get("customerId");
    return NextResponse.json({ context: await getDriverPosContext(customerId) });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json({ message: "Impossible de charger le POS." }, { status: 500 });
  }
}
