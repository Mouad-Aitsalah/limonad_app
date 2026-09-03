import { NextResponse } from "next/server";

import { refreshCurrentSession } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Polled by the client (see hooks/use-auth.tsx) on mount, on resume and on a
 * slow interval. Phase 5C: this is also the one place a still-active session
 * gets its window slid forward (refreshCurrentSession), so a driver who
 * keeps the app open through a long day is not logged out mid-tour.
 */
export async function GET() {
  return NextResponse.json({ user: await refreshCurrentSession() });
}
