import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import {
  getAccountingSettings,
  updateAccountingSettings,
} from "@/lib/server/accounting";
import { OperationsServiceError } from "@/lib/server/depots";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";

export async function GET() {
  try {
    return NextResponse.json({ settings: await getAccountingSettings() });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de charger les parametres comptables." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  try {
    const body = await request.json();
    const settings = await updateAccountingSettings(body);
    return NextResponse.json({ settings });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de mettre a jour les parametres comptables." },
      { status: 500 },
    );
  }
}
