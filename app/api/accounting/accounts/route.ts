import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import {
  createAccountingAccount,
  listAccountingAccounts,
} from "@/lib/server/accounting";
import { OperationsServiceError } from "@/lib/server/depots";

export async function GET() {
  try {
    return NextResponse.json({ accounts: await listAccountingAccounts() });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de charger les comptes comptables." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const account = await createAccountingAccount(body);
    return NextResponse.json({ account }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de creer le compte comptable." },
      { status: 500 },
    );
  }
}
