import { NextResponse } from "next/server";
import { z } from "zod";

import { AuthServiceError, loginWithPasswordForMobile } from "@/lib/server/auth";
import { isRateLimited, recordFailure, recordSuccess } from "@/lib/server/login-rate-limit";
import { handleMobilePreflight, withMobileCors } from "@/lib/server/mobile-cors";

/**
 * PHASE 5A.1 - "1. AUTH MOBILE SÉPARÉE".
 *
 * Dedicated login endpoint for the Capacitor driver shell (mobile/driver/) -
 * never exposes the raw session token through the existing /api/auth/login,
 * which stays cookie-only and unchanged for the web app. Reuses the exact
 * same credential validation as the web login (see authenticateUser inside
 * lib/server/auth.ts, shared by both loginWithPassword and
 * loginWithPasswordForMobile) - no duplicated security logic.
 *
 * Deliberately does NOT call rejectUntrustedOrigin (lib/server/csrf.ts):
 * that check exists to defend the COOKIE-based web login against
 * cross-site requests riding on the browser's ambient cookie. A mobile
 * client authenticates with a bearer token it must explicitly attach to
 * every request - there is no ambient credential here for a forged
 * cross-site request to exploit, so CSRF defense does not apply. Cross-
 * origin access is instead controlled by the explicit CORS allowlist below
 * (see lib/server/mobile-cors.ts) - which does not block a non-browser
 * caller from reaching this route (CORS is a browser-enforced response
 * check, not a server-side request gate), so brute-force/credential
 * validation still fully applies regardless of Origin.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const loginSchema = z.object({
  email: z.string().email("Email invalide."),
  password: z.string().min(1, "Le mot de passe est obligatoire."),
});

export async function OPTIONS(request: Request) {
  return handleMobilePreflight(request);
}

export async function POST(request: Request) {
  const clientIp = getClientIp(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withMobileCors(
      request,
      NextResponse.json({ success: false, message: "Identifiants invalides." }, { status: 422 }),
    );
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return withMobileCors(
      request,
      NextResponse.json({ success: false, message: "Identifiants invalides." }, { status: 422 }),
    );
  }

  const email = parsed.data.email.trim().toLowerCase();
  // Same two-bucket brute-force guard as /api/auth/login (shared module) -
  // a mobile attacker gets no more attempts than a web one.
  const ipKey = `mobile-ip:${clientIp}`;
  const emailKey = `mobile-email:${email}`;
  const ipLimit = isRateLimited(ipKey);
  const emailLimit = isRateLimited(emailKey);
  if (ipLimit.blocked || emailLimit.blocked) {
    const retryAfterSeconds = Math.max(ipLimit.retryAfterSeconds, emailLimit.retryAfterSeconds);
    return withMobileCors(
      request,
      NextResponse.json(
        { success: false, message: "Trop de tentatives. Reessayez dans quelques minutes." },
        { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
      ),
    );
  }

  try {
    const { accessToken, user } = await loginWithPasswordForMobile(email, parsed.data.password);
    recordSuccess(ipKey);
    recordSuccess(emailKey);
    return withMobileCors(request, NextResponse.json({ success: true, accessToken, user }));
  } catch (error) {
    recordFailure(ipKey);
    recordFailure(emailKey);

    if (error instanceof AuthServiceError) {
      return withMobileCors(
        request,
        NextResponse.json({ success: false, message: error.message }, { status: error.status }),
      );
    }

    return withMobileCors(
      request,
      NextResponse.json({ success: false, message: "Impossible de se connecter." }, { status: 500 }),
    );
  }
}

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}
