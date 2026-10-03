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
 */
export async function GET() {
  const user = await getCurrentSessionUser();
  return NextResponse.json({ ok: Boolean(user) }, { headers: { "Cache-Control": "no-store" } });
}
