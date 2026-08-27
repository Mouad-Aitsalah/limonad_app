import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import {
  createCreditNote,
  getCreditNotes,
} from "@/lib/server/credit-notes";
import { OperationsServiceError } from "@/lib/server/depots";
import type { CreditNoteStatus } from "@/types/credit-note";

const acceptedStatuses: CreditNoteStatus[] = ["BROUILLON", "VALIDE", "CONTREPASSE"];

export async function GET() {
  try {
    return NextResponse.json({ creditNotes: await getCreditNotes() });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json({ message: "Impossible de charger les avoirs." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const requestedStatus = body.status as CreditNoteStatus | undefined;
    const status = requestedStatus && acceptedStatuses.includes(requestedStatus)
      ? requestedStatus
      : "VALIDE";
    const creditNote = await createCreditNote(body, status);
    return NextResponse.json({ creditNote }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    if (error instanceof OperationsServiceError) {
      return NextResponse.json(
        { message: error.message, fieldErrors: error.fieldErrors },
        { status: error.status },
      );
    }
    return NextResponse.json({ message: "Impossible de creer l'avoir." }, { status: 500 });
  }
}
