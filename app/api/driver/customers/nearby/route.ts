import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { getDriverProximityCustomers } from "@/lib/server/driver-customers";
import { OperationsServiceError } from "@/lib/server/depots";

/**
 * Phase 3 CRITICAL #2 fix (included extra): bounded companion to
 * GET /api/driver/customers, used only by the runtime GPS-proximity feed
 * (hooks/use-driver-runtime.tsx) - see getDriverProximityCustomers's doc
 * comment in lib/server/driver-customers.ts. /driver/clients keeps using
 * GET /api/driver/customers unchanged.
 */
export async function GET() {
  try {
    return NextResponse.json({ customers: await getDriverProximityCustomers() });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json({ message: "Impossible de charger les clients proches." }, { status: 500 });
  }
}
