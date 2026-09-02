import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { updateCategory } from "@/lib/server/categories";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  try {
    const { id } = await context.params;

    return NextResponse.json({
      category: await updateCategory(id, await request.json()),
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
      { message: "Impossible de modifier la categorie." },
      { status: 500 },
    );
  }
}
