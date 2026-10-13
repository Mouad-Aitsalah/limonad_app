import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { listAccountingDraftEntries } from "@/lib/server/accounting";
import { OperationsServiceError } from "@/lib/server/depots";
import { rejectDisabledModule } from "@/lib/server/module-guard";

export async function GET(request: Request) {
  const moduleRejection = await rejectDisabledModule(request);
  if (moduleRejection) return moduleRejection;
  try {
    return NextResponse.json({ entries: await listAccountingDraftEntries() });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de charger les ecritures archivees." },
      { status: 500 },
    );
  }
}
