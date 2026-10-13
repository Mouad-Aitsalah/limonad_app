import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { createPurchase, getPurchases } from "@/lib/server/purchases";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { reportUnexpected } from "@/lib/server/report-error";
import { rejectDisabledModule } from "@/lib/server/module-guard";

export async function GET(request: Request) {
  const moduleRejection = await rejectDisabledModule(request);
  if (moduleRejection) return moduleRejection;
  try {
    return NextResponse.json({ purchases: await getPurchases() });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }

    console.error("GET /api/purchases failed", error);
    return NextResponse.json(
      { message: "Impossible de charger les achats." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const moduleRejection = await rejectDisabledModule(request);
  if (moduleRejection) return moduleRejection;
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  try {
    return NextResponse.json(
      { purchase: await createPurchase(await request.json()) },
      { status: 201 },
    );
  } catch (error) {
    reportUnexpected(error, {
      route: "POST /api/purchases",
      area: "purchases",
      op: "createPurchase",
    });
    if (error instanceof AuthServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    if (error instanceof OperationsServiceError) {
      return NextResponse.json(
        { message: error.message, fieldErrors: error.fieldErrors },
        { status: error.status },
      );
    }

    console.error("POST /api/purchases failed", error);
    return NextResponse.json(
      { message: "Impossible d'enregistrer l'achat." },
      { status: 500 },
    );
  }
}
