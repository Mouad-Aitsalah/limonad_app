import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { OperationsServiceError } from "@/lib/server/depots";
import { createQuickCustomerForCurrentDriver } from "@/lib/server/driver-customers";
import { reportUnexpected } from "@/lib/server/report-error";

/**
 * POST /api/driver/customers/quick
 *
 * "Ajout rapide client" from the driver GPS/tournée screen: body is just
 * `{ name, latitude, longitude, locationAccuracy? }`. organizationId /
 * driverId / truckId / createdByUserId / code are all derived server-side
 * from the authenticated driver session (never trusted from the body).
 */
export async function POST(request: Request) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  try {
    const body = await request.json();
    return NextResponse.json(
      { customer: await createQuickCustomerForCurrentDriver(body) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    if (error instanceof OperationsServiceError) {
      return NextResponse.json(
        { message: error.message, fieldErrors: error.fieldErrors },
        { status: error.status },
      );
    }
    reportUnexpected(error, { route: "POST /api/driver/customers/quick", area: "driver" });
    return NextResponse.json({ message: "Impossible d'enregistrer le client." }, { status: 500 });
  }
}
