import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { updateBusinessAccount } from "@/lib/server/business-accounts";
import { OperationsServiceError } from "@/lib/server/depots";

type RouteContext = { params: Promise<{ accountId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { accountId } = await context.params;

  try {
    return NextResponse.json({
      account: await updateBusinessAccount(accountId, await request.json()),
    });
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
      { message: "Impossible de modifier le compte." },
      { status: 500 },
    );
  }
}
