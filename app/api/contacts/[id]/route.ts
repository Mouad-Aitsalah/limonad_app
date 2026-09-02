import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { getContactById, mapContactError, updateContact } from "@/lib/server/contacts";
import { OperationsServiceError } from "@/lib/server/depots";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    return NextResponse.json({ contact: await getContactById(id) });
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  const { id } = await context.params;
  try {
    const body = await request.json();
    return NextResponse.json({ contact: await updateContact(id, body) });
  } catch (error) {
    return handleError(error);
  }
}

function handleError(error: unknown) {
  if (error instanceof AuthServiceError) {
    return NextResponse.json({ message: error.message }, { status: error.status });
  }
  if (error instanceof OperationsServiceError) {
    return NextResponse.json(
      { message: error.message, fieldErrors: error.fieldErrors },
      { status: error.status },
    );
  }
  const mapped = mapContactError(error);
  return NextResponse.json(
    { message: mapped.message, fieldErrors: mapped.fieldErrors },
    { status: mapped.status },
  );
}
