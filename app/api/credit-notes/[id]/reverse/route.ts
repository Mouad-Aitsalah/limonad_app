import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { reverseCreditNote } from "@/lib/server/credit-notes";
import { OperationsServiceError } from "@/lib/server/depots";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { reportUnexpected } from "@/lib/server/report-error";

type CreditNoteRouteProps = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: CreditNoteRouteProps) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  try {
    const { id } = await params;
    return NextResponse.json({ creditNote: await reverseCreditNote(id) });
  } catch (error) {
    reportUnexpected(error, {
      route: "POST /api/credit-notes/[id]/reverse",
      area: "credit-notes",
      op: "reverseCreditNote",
    });
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de contre-passer l'avoir." },
      { status: 500 },
    );
  }
}
