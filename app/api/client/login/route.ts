import { NextResponse } from "next/server";

import {
  CLIENT_LOGIN_FAILED_MESSAGE,
  clientIpFromHeaders,
  clientLoginSchema,
  normalizeContactPhone,
} from "@/lib/client-portal-rules";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { ClientAuthError, loginClient } from "@/lib/server/client-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/client/login - Espace Client identification: organisation code +
 * customer code (both mandatory), optional contact phone (never an identity
 * proof). Throttled per IP and per organisation (database-backed), one
 * generic error for every failure.
 */
export async function POST(request: Request) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;

  const parsed = clientLoginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Le code organisation et le code client sont obligatoires." },
      { status: 422 },
    );
  }

  const contactPhone = normalizeContactPhone(parsed.data.phone);
  if (contactPhone === "invalid") {
    return NextResponse.json(
      { message: "Le numéro de téléphone est invalide.", field: "phone" },
      { status: 422 },
    );
  }

  try {
    const client = await loginClient(
      {
        organizationCode: parsed.data.organizationCode,
        customerCode: parsed.data.customerCode,
        contactPhone,
      },
      { ip: clientIpFromHeaders(request.headers) },
    );
    return NextResponse.json({ client: { customerName: client.customerName } });
  } catch (error) {
    if (error instanceof ClientAuthError) {
      return NextResponse.json(
        { message: error.message },
        { status: error.status, ...(error.status === 429 ? { headers: { "Retry-After": "900" } } : {}) },
      );
    }
    console.error("Erreur connexion Espace Client :", error);
    return NextResponse.json({ message: CLIENT_LOGIN_FAILED_MESSAGE }, { status: 500 });
  }
}
