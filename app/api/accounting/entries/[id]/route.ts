import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import {
  deleteDraftAccountingEntry,
  reviseManualAccountingEntry,
  updateManualDraftEntry,
} from "@/lib/server/accounting";
import { OperationsServiceError } from "@/lib/server/depots";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PATCH — edit a manual accounting entry.
 *   mode "draft"  -> updateManualDraftEntry  (an un-validated brouillon, edited in place)
 *   mode "revise" -> reviseManualAccountingEntry (a POSTED manual entry: contre-passée + remplacée)
 * The client passes `mode`; the server still re-checks the entry's real
 * status/sourceType before doing anything.
 */
export async function PATCH(request: Request, context: RouteContext) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  const { id } = await context.params;
  try {
    const body = await request.json();
    const mode = body?.mode === "revise" ? "revise" : "draft";
    const entry =
      mode === "revise"
        ? await reviseManualAccountingEntry(id, body)
        : await updateManualDraftEntry(id, body);
    return NextResponse.json({ entry });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de modifier l'ecriture comptable." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  const { id } = await context.params;
  try {
    await deleteDraftAccountingEntry(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de supprimer l'ecriture archivee." },
      { status: 500 },
    );
  }
}
