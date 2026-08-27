import { NextResponse } from "next/server";

import {
  createOrganization,
  listOrganizations,
} from "@/lib/server/organizations";
import { OperationsServiceError } from "@/lib/server/depots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ organizations: await listOrganizations() });
  } catch (error) {
    if (error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { message: "Impossible de charger les organisations." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const organization = await createOrganization(await request.json());
    return NextResponse.json({ organization }, { status: 201 });
  } catch (error) {
    if (error instanceof OperationsServiceError) {
      return NextResponse.json(
        { message: error.message, fieldErrors: error.fieldErrors },
        { status: error.status },
      );
    }

    return NextResponse.json(
      { message: "Impossible de creer l'organisation." },
      { status: 500 },
    );
  }
}
