import { NextResponse } from "next/server";

import { getCurrentSessionUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ user: await getCurrentSessionUser() });
}
