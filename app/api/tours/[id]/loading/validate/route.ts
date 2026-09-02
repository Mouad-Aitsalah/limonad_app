import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { mapLoadingError, validateLoading } from "@/lib/server/truck-loadings";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { reportUnexpected } from "@/lib/server/report-error";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  const { id } = await context.params;
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({ loading: await validateLoading(id, body) });
  } catch (error) {
    reportUnexpected(error, {
      route: "POST /api/tours/[id]/loading/validate",
      area: "truck-loading",
      op: "validateLoading",
    });
    if (error instanceof AuthServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    if (error instanceof OperationsServiceError) return serviceErrorResponse(error);
    const mapped = mapLoadingError(error);
    return serviceErrorResponse(mapped);
  }
}

function serviceErrorResponse(error: OperationsServiceError) {
  return NextResponse.json(
    { message: error.message, fieldErrors: error.fieldErrors },
    { status: error.status },
  );
}
