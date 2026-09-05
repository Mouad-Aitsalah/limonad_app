import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { listAccountingDraftEntries } from "@/lib/server/accounting";
import { OperationsServiceError } from "@/lib/server/depots";

export async function GET() {
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
