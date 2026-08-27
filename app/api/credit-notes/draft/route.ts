import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { saveCreditNoteDraft } from "@/lib/server/credit-notes";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const creditNote = await saveCreditNoteDraft(body);
    return NextResponse.json({ creditNote }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible d'enregistrer le brouillon d'avoir." },
      { status: 500 },
    );
  }
}
