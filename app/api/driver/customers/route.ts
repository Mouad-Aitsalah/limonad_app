import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import {
  createCustomerForCurrentDriver,
  getCustomersForCurrentDriver,
} from "@/lib/server/driver-customers";
import { OperationsServiceError } from "@/lib/server/depots";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";

export async function GET() {
  try {
    return NextResponse.json({ customers: await getCustomersForCurrentDriver() });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json({ message: "Impossible de charger les clients." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  try {
    const body = await request.json();
    return NextResponse.json(
      { customer: await createCustomerForCurrentDriver(body, body.id) },
      { status: body.id ? 200 : 201 },
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
    return NextResponse.json({ message: "Impossible d'enregistrer le client." }, { status: 500 });
  }
}
