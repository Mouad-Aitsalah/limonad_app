import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { getCreditNoteById } from "@/lib/server/credit-notes";
import { OperationsServiceError } from "@/lib/server/depots";

type CreditNoteRouteProps = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, { params }: CreditNoteRouteProps) {
  try {
    const { id } = await params;
    return NextResponse.json({ creditNote: await getCreditNoteById(id) });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json({ message: "Impossible de charger l'avoir." }, { status: 500 });
  }
}
