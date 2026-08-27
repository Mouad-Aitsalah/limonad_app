import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { mapLoadingError, updateLoadingLines } from "@/lib/server/truck-loadings";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const loading = await updateLoadingLines(id, await request.json());
    return NextResponse.json({ loading });
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
    const mapped = mapLoadingError(error);
    return NextResponse.json(
      {
        message: mapped.message,
        fieldErrors: mapped instanceof OperationsServiceError ? mapped.fieldErrors : undefined,
      },
      { status: mapped.status },
    );
  }
}
