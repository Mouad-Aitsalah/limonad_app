import { NextResponse } from "next/server";

import {
  getOrganizationById,
  updateOrganization,
} from "@/lib/server/organizations";
import { OperationsServiceError } from "@/lib/server/depots";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ organization: await getOrganizationById(id) });
  } catch (error) {
    if (error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { message: "Impossible de charger l'organisation." },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  try {
    const { id } = await context.params;
    const organization = await updateOrganization(id, await request.json());
    return NextResponse.json({ organization });
  } catch (error) {
    if (error instanceof OperationsServiceError) {
      return NextResponse.json(
        { message: error.message, fieldErrors: error.fieldErrors },
        { status: error.status },
      );
    }

    return NextResponse.json(
      { message: "Impossible de mettre a jour l'organisation." },
      { status: 500 },
    );
  }
}
