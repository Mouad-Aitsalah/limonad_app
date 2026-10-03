import { NextResponse } from "next/server";

import { getCurrentSessionUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Lightweight "this device is still here" ping, sent every minute by the web
 * client while a tab is visible (see hooks/use-auth.tsx). Resolving the
 * session through getCurrentSessionUser also stamps the session's lastUsedAt
 * (throttled), which is what the SUPER_ADMIN live-connections view reads.
 * Returns nothing about the user; it never renews or alters the session.
 *
 * 401 when the session no longer exists (signed out from another place,
 * "Deconnecter tous les appareils", expiry, disabled account): the client
 * (hooks/use-auth.tsx) then re-checks the session and returns to /login.
 */
export async function GET() {
  const user = await getCurrentSessionUser();
  const headers = { "Cache-Control": "no-store" };
  if (!user) {
    return NextResponse.json({ ok: false, reason: "session_ended" }, { status: 401, headers });
  }
  return NextResponse.json({ ok: true }, { headers });
}
