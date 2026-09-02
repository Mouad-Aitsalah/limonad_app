import { NextResponse } from "next/server";

import { clearSessionCookie } from "@/lib/server/auth";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
