import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import {
  createEmployee,
  getEmployees,
  mapEmployeeError,
} from "@/lib/server/employees";
import { OperationsServiceError } from "@/lib/server/depots";

export async function GET() {
  try {
    return NextResponse.json(await getEmployees());
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    return NextResponse.json({ employee: await createEmployee(body) }, { status: 201 });
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
  const mapped = mapEmployeeError(error);
  return NextResponse.json(
    { message: mapped.message, fieldErrors: mapped.fieldErrors },
    { status: mapped.status },
  );
}
