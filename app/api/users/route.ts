import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { createUser, getUsers } from "@/lib/server/users";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";

export async function GET() {
  try {
    return NextResponse.json({ users: await getUsers() });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  try {
    const body = await request.json();
    return NextResponse.json({ user: await createUser(body) }, { status: 201 });
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
  return NextResponse.json({ message: "Une erreur est survenue." }, { status: 500 });
}
