import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { AuthServiceError } from "@/lib/server/auth";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { OperationsServiceError } from "@/lib/server/depots";
import { requireOrganizationUser } from "@/lib/server/organization-context";
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

const DATA_URI_PATTERN = /^data:([^;,]*)(;base64)?,([\s\S]*)$/;

/**
 * Serves ONE supplier logo decoded from Supplier.logoUrl (a data: URI), so the
 * counter POS context can carry a short link instead of the logo repeated on
 * every product row. Same organisation scoping as the rest of the app; the URL
 * is versioned with `?v=<updatedAt>` (see toLightweightSupplierLogoUrl), which
 * makes the immutable cache safe.
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const user = await requireOrganizationUser(["admin", "depot_manager", "cashier", "driver"]);
    const supplier = await prisma.supplier.findFirst({
      where: { id, organizationId: user.organizationId },
      select: { logoUrl: true },
    });
    if (!supplier?.logoUrl) return new NextResponse(null, { status: 404 });

    const match = DATA_URI_PATTERN.exec(supplier.logoUrl);
    if (!match) return NextResponse.redirect(supplier.logoUrl);

    const [, mimeType, isBase64, payload] = match;
    const bytes = isBase64
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf8");
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": mimeType || "application/octet-stream",
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json({ message: "Impossible de charger le logo." }, { status: 500 });
  }
}
