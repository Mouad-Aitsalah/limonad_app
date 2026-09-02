import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { createContact, getContacts, mapContactError } from "@/lib/server/contacts";
import { OperationsServiceError } from "@/lib/server/depots";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { reportUnexpected } from "@/lib/server/report-error";

export async function GET() {
  try {
    return NextResponse.json(await getContacts());
  } catch (error) {
    reportUnexpected(error, { route: "GET /api/contacts" });
    return handleError(error);
  }
}

export async function POST(request: Request) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  try {
    const body = await request.json();
    return NextResponse.json({ contact: await createContact(body) }, { status: 201 });
  } catch (error) {
    reportUnexpected(error, { route: "POST /api/contacts" });
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
