import { NextResponse } from "next/server";

import { revokeSessionByToken } from "@/lib/server/auth";
import { handleMobilePreflight, withMobileCors } from "@/lib/server/mobile-cors";

/**
 * PHASE 5A.1 - "3. LOGOUT MOBILE". Revokes the Session behind the caller's
 * own Bearer token - never relies on a cookie (mobile never has one). A
 * missing/malformed header, or a token that is already invalid/unknown,
 * still returns success: logout must always look like it worked from the
 * client's point of view (see revokeSessionByToken's own doc comment), and
 * either way the caller's local copy of the token is discarded.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function OPTIONS(request: Request) {
  return handleMobilePreflight(request);
}

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const match = authHeader ? /^Bearer\s+(.+)$/i.exec(authHeader.trim()) : null;
  const token = match?.[1]?.trim();

  if (token) {
    await revokeSessionByToken(token);
  }

  return withMobileCors(request, NextResponse.json({ success: true }));
}
