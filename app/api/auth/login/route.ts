import { NextResponse } from "next/server";
import { z } from "zod";

import { AuthServiceError, loginWithPassword } from "@/lib/server/auth";
import { getDefaultRouteForRole } from "@/lib/auth/default-route";
import { isRateLimited, recordFailure, recordSuccess } from "@/lib/server/login-rate-limit";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";

const loginSchema = z.object({
  email: z.string().email("Email invalide."),
  password: z.string().min(1, "Le mot de passe est obligatoire."),
});

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RATE_LIMIT_MESSAGE = "Trop de tentatives. Reessayez dans quelques minutes.";

export async function POST(request: Request) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  const contentType = request.headers.get("content-type") ?? "";
  const isJsonRequest = contentType.includes("application/json");
  const clientIp = getClientIp(request);

  let body: unknown;
  try {
    body = isJsonRequest
      ? await request.json()
      : Object.fromEntries((await request.formData()).entries());
  } catch {
    return NextResponse.json(
      { message: "Identifiants invalides." },
      { status: 422 },
    );
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    if (isJsonRequest) {
      return NextResponse.json(
        { message: "Identifiants invalides." },
        { status: 422 },
      );
    }

    return NextResponse.redirect(
      new URL("/login?error=invalid_credentials", request.url),
      { status: 303 },
    );
  }

  const email = parsed.data.email.trim().toLowerCase();
  // Two independent dimensions, blocked if either trips: a single IP hammering
  // many accounts, or many IPs hammering one account (credential stuffing).
  const ipKey = `ip:${clientIp}`;
  const emailKey = `email:${email}`;
  const ipLimit = isRateLimited(ipKey);
  const emailLimit = isRateLimited(emailKey);
  if (ipLimit.blocked || emailLimit.blocked) {
    const retryAfterSeconds = Math.max(ipLimit.retryAfterSeconds, emailLimit.retryAfterSeconds);
    logLoginAttempt({ email, ip: clientIp, outcome: "rate_limited" });

    if (isJsonRequest) {
      return NextResponse.json(
        { message: RATE_LIMIT_MESSAGE },
        { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
      );
    }

    return NextResponse.redirect(
      new URL("/login?error=rate_limited", request.url),
      { status: 303 },
    );
  }

  try {
    const user = await loginWithPassword(email, parsed.data.password);
    recordSuccess(ipKey);
    recordSuccess(emailKey);
    logLoginAttempt({ email, ip: clientIp, outcome: "success" });

    if (isJsonRequest) {
      return NextResponse.json({ user });
    }

    return NextResponse.redirect(
      new URL(getDefaultRouteForRole(user.role), request.url),
      { status: 303 },
    );
  } catch (error) {
    recordFailure(ipKey);
    recordFailure(emailKey);
    logLoginAttempt({ email, ip: clientIp, outcome: "failed" });

    if (error instanceof AuthServiceError) {
      if (isJsonRequest) {
        return NextResponse.json({ message: error.message }, { status: error.status });
      }

      return NextResponse.redirect(
        new URL(`/login?error=${mapLoginErrorToQuery(error)}`, request.url),
        { status: 303 },
      );
    }

    if (isJsonRequest) {
      return NextResponse.json(
        { message: "Impossible de se connecter." },
        { status: 500 },
      );
    }

    return NextResponse.redirect(
      new URL("/login?error=login_failed", request.url),
      { status: 303 },
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

// Server-side only (never sent to the client): no password, no session
// token, ever. The attempted email is logged deliberately, same as most
// auth providers' security logs, to let an operator tell a targeted attack
// on one account apart from a broad credential-stuffing spray - adjust if
// your compliance requirements call for masking it further.
function logLoginAttempt(entry: { email: string; ip: string; outcome: "success" | "failed" | "rate_limited" }) {
  console.warn(
    `[auth] login ${entry.outcome} email=${entry.email} ip=${entry.ip} at=${new Date().toISOString()}`,
  );
}

function mapLoginErrorToQuery(error: AuthServiceError) {
  if (error.status === 403) {
    return "inactive_account";
  }

  if (error.status === 401) {
    return "invalid_credentials";
  }

  return "login_failed";
}
