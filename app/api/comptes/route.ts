import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import {
  createBusinessAccount,
  getBusinessAccountsPage,
} from "@/lib/server/business-accounts";
import { OperationsServiceError } from "@/lib/server/depots";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const pageSizeParam = url.searchParams.get("pageSize");
    const page = await getBusinessAccountsPage({
      cursor: url.searchParams.get("cursor") || undefined,
      pageSize: pageSizeParam ? Number(pageSizeParam) : undefined,
      type: url.searchParams.get("type") || undefined,
      status: url.searchParams.get("status") || undefined,
      city: url.searchParams.get("city") || undefined,
      search: url.searchParams.get("search") || undefined,
    });
    return NextResponse.json(page);
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
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
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
