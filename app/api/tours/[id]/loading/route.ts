import { NextResponse } from "next/server";

import { AuthServiceError, requireSessionUser } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import {
  createLoading,
  getLoadingByTourId,
  mapLoadingError,
  updateDraftLoading,
} from "@/lib/server/truck-loadings";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    await requireSessionUser(["admin", "depot_manager"]);
    return NextResponse.json({ loading: await getLoadingByTourId(id) });
  } catch (error) {
    const mapped = mapLoadingError(error);
    return NextResponse.json({ message: mapped.message }, { status: mapped.status });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    return NextResponse.json(
      { loading: await createLoading(id, await request.json()) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    if (error instanceof OperationsServiceError) return serviceErrorResponse(error);
    const mapped = mapLoadingError(error);
    return serviceErrorResponse(mapped);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    return NextResponse.json({
      loading: await updateDraftLoading(id, await request.json()),
    });
  } catch (error) {
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
