import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import {
  createManualAccountingEntry,
  listAccountingEntries,
} from "@/lib/server/accounting";
import { OperationsServiceError } from "@/lib/server/depots";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { rejectDisabledModule } from "@/lib/server/module-guard";

export async function GET(request: Request) {
  const moduleRejection = await rejectDisabledModule(request);
  if (moduleRejection) return moduleRejection;
  try {
    return NextResponse.json({ entries: await listAccountingEntries() });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de charger les ecritures comptables." },
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
    const body = await request.json();
    const entry = await createManualAccountingEntry(body);
    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de creer l'ecriture comptable." },
      { status: 500 },
    );
  }
}
