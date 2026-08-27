import { NextResponse } from "next/server";
import { z } from "zod";

import { AuthServiceError, loginWithPassword } from "@/lib/server/auth";
import { getDefaultRouteForRole } from "@/lib/auth/default-route";

const loginSchema = z.object({
  email: z.string().email("Email invalide."),
  password: z.string().min(1, "Le mot de passe est obligatoire."),
});

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  const isJsonRequest = contentType.includes("application/json");

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

  try {
    const user = await loginWithPassword(parsed.data.email, parsed.data.password);

    if (isJsonRequest) {
      return NextResponse.json({ user });
    }

    return NextResponse.redirect(
      new URL(getDefaultRouteForRole(user.role), request.url),
      { status: 303 },
    );
  } catch (error) {
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

function mapLoginErrorToQuery(error: AuthServiceError) {
  if (error.status === 403) {
    return "inactive_account";
  }

  if (error.status === 401) {
    return "invalid_credentials";
  }

  return "login_failed";
}
