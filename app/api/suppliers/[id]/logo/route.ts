import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { OperationsServiceError } from "@/lib/server/depots";
import { updateSupplierLogo } from "@/lib/server/suppliers";

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: RouteContext) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;

  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { logoDataUrl?: unknown };
    const logoDataUrl =
      body.logoDataUrl === null || typeof body.logoDataUrl === "string"
        ? body.logoDataUrl
        : null;
    return NextResponse.json({ logo: await updateSupplierLogo(id, logoDataUrl) });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible d'enregistrer le logo du fournisseur." },
      { status: 500 },
    );
  }
}
