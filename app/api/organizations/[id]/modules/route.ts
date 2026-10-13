import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { OperationsServiceError } from "@/lib/server/depots";
import { getOrganizationModules, updateOrganizationModules } from "@/lib/server/organization-modules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

type RouteContext = { params: Promise<{ id: string }> };

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
    return NextResponse.json(
      { message: error.message, fieldErrors: error instanceof OperationsServiceError ? error.fieldErrors : undefined },
      { status: error.status, headers: NO_STORE },
    );
  }
  console.error("[organization-modules] unexpected failure", {
    name: error instanceof Error ? error.name : typeof error,
    code: (error as { code?: unknown } | null)?.code,
  });
  return NextResponse.json({ message: fallback }, { status: 500, headers: NO_STORE });
}

/**
 * GET /api/organizations/[id]/modules - the modules of ONE organisation.
 * PUT  /api/organizations/[id]/modules - body { modules: { [key]: boolean } }.
 * SUPER_ADMIN only (enforced in lib/server/organization-modules.ts, 401/403
 * otherwise), CSRF-checked on PUT. Only the organisation of the URL is touched.
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json(await getOrganizationModules(id), { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error, "Impossible de charger les modules.");
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => null);
    return NextResponse.json(await updateOrganizationModules(id, body), { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error, "Impossible d'enregistrer les modules.");
  }
}
