import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import {
  createBusinessAccount,
  getBusinessAccounts,
} from "@/lib/server/business-accounts";
import { OperationsServiceError } from "@/lib/server/depots";

export async function GET() {
  try {
    return NextResponse.json(await getBusinessAccounts());
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de charger les comptes." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    return NextResponse.json(
      { account: await createBusinessAccount(await request.json()) },
      { status: 201 },
    );
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
    return NextResponse.json(
      { message: "Impossible de creer le compte." },
      { status: 500 },
    );
  }
}
