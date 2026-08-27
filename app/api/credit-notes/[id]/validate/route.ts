import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { validateCreditNote } from "@/lib/server/credit-notes";
import { OperationsServiceError } from "@/lib/server/depots";

type CreditNoteRouteProps = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, { params }: CreditNoteRouteProps) {
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
