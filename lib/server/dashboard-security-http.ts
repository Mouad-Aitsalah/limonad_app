import "server-only";

import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { DASHBOARD_GRANT_COOKIE } from "@/lib/server/dashboard-security";

/** Shared by the dashboard-security routes: no-store, generic errors, grant cookie. */
export const DASHBOARD_SECURITY_NO_STORE = { "Cache-Control": "no-store" } as const;

export function dashboardSecurityErrorResponse(error: unknown, fallback: string) {
  if (error instanceof AuthServiceError) {
    return NextResponse.json({ message: error.message }, { status: error.status, headers: DASHBOARD_SECURITY_NO_STORE });
  }
  // Never log the request body or any secret: only the kind of error.
  console.error("[dashboard-security] unexpected failure", {
    name: error instanceof Error ? error.name : typeof error,
    code: (error as { code?: unknown } | null)?.code,
  });
  return NextResponse.json({ message: fallback }, { status: 500, headers: DASHBOARD_SECURITY_NO_STORE });
}

/** httpOnly session cookie (no max-age: gone when the browser closes), never readable by page scripts. */
export function setDashboardGrantCookie(response: NextResponse, token: string): void {
  response.cookies.set(DASHBOARD_GRANT_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

export function clearDashboardGrantCookie(response: NextResponse): void {
  response.cookies.set(DASHBOARD_GRANT_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}
