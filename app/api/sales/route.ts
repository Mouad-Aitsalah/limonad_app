import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { createCounterSale } from "@/lib/server/counter-sales";
import { OperationsServiceError } from "@/lib/server/depots";
import { getAllSales } from "@/lib/server/driver-sales";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { reportUnexpected } from "@/lib/server/report-error";
import { rejectDisabledModule } from "@/lib/server/module-guard";

export async function GET(request: Request) {
  const moduleRejection = await rejectDisabledModule(request);
  if (moduleRejection) return moduleRejection;
  try {
    return NextResponse.json({ sales: await getAllSales() });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json({ message: "Impossible de charger les ventes." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const moduleRejection = await rejectDisabledModule(request);
  if (moduleRejection) return moduleRejection;
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  try {
    const body = await request.json();
    // collectNow:false = "Préparer la facture" (persisted DRAFT, no payment
    // yet). Anything else keeps the immediate create+pay behaviour.
    const collectNow = body?.collectNow !== false;
    return NextResponse.json(
      { sale: await createCounterSale(body, { collectNow }) },
      { status: 201 },
    );
  } catch (error) {
    reportUnexpected(error, { route: "POST /api/sales", area: "sales", op: "createCounterSale" });
    if (error instanceof AuthServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    if (error instanceof OperationsServiceError) {
      return NextResponse.json(
        { message: error.message, fieldErrors: error.fieldErrors },
        { status: error.status },
      );
    }
    return NextResponse.json({ message: "Impossible d'enregistrer la vente." }, { status: 500 });
  }
}
