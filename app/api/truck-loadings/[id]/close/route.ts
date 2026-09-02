import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { closeLoading, mapLoadingError } from "@/lib/server/truck-loadings";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  const { id } = await context.params;
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({ loading: await closeLoading(id, body) });
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
