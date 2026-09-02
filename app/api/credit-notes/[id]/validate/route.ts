import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { validateCreditNote } from "@/lib/server/credit-notes";
import { OperationsServiceError } from "@/lib/server/depots";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";

type CreditNoteRouteProps = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: CreditNoteRouteProps) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  try {
    const { id } = await params;
    return NextResponse.json({ creditNote: await validateCreditNote(id) });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json({ message: "Impossible de valider l'avoir." }, { status: 500 });
  }
}
