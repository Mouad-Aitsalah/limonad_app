import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { validateDraftAccountingEntry } from "@/lib/server/accounting";
import { OperationsServiceError } from "@/lib/server/depots";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  const { id } = await context.params;
  try {
    return NextResponse.json({ entry: await validateDraftAccountingEntry(id) });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de valider l'ecriture archivee." },
      { status: 500 },
    );
  }
}
