import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { createManualCreditNote } from "@/lib/server/credit-notes";
import { OperationsServiceError } from "@/lib/server/depots";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const creditNote = await createManualCreditNote(body);
    return NextResponse.json({ creditNote }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de valider l'avoir manuel." },
      { status: 500 },
    );
  }
}
