import { NextResponse } from "next/server";

import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { revokeOrganizationUserSessions } from "@/lib/server/organization-connections";
import { SessionRevocationError } from "@/lib/session-revocation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * SUPER_ADMIN only: "Deconnecter tous les appareils" of one user of the given
 * organization. Authentication, the SUPER_ADMIN role and the user/organization
 * match are enforced inside revokeOrganizationUserSessions; the origin check
 * protects this state-changing request against cross-site calls.
 *
 * Response: { revokedSessions, connections } - counts only, never a token,
 * a session id or a device id.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; userId: string }> },
) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;

  try {
    const { id, userId } = await context.params;
    const result = await revokeOrganizationUserSessions(id, userId);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    if (
      error instanceof AuthServiceError ||
      error instanceof OperationsServiceError ||
      error instanceof SessionRevocationError
    ) {
      return NextResponse.json(
        { message: error.message },
        { status: error.status, headers: NO_STORE },
      );
    }

    console.error("[auth] session revocation failed", {
      name: error instanceof Error ? error.name : typeof error,
      code: (error as { code?: unknown } | null)?.code,
    });
    return NextResponse.json(
      { message: "Impossible de deconnecter les appareils de cet utilisateur." },
      { status: 500, headers: NO_STORE },
    );
  }
}
