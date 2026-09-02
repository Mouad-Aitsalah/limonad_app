import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import {
  createOrReuseOpenLoading,
  getLoadingHistoryPage,
  mapLoadingError,
} from "@/lib/server/truck-loadings";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor");
    const pageSizeParam = url.searchParams.get("pageSize");
    const page = await getLoadingHistoryPage({
      cursor: cursor || undefined,
      pageSize: pageSizeParam ? Number(pageSizeParam) : undefined,
    });
    return NextResponse.json(page);
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de charger l'historique des chargements." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  try {
    const { loading, reused } = await createOrReuseOpenLoading(await request.json());
    return NextResponse.json({ loading, reused }, { status: reused ? 200 : 201 });
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
