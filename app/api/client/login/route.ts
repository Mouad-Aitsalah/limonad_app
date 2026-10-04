import { NextResponse } from "next/server";
import { z } from "zod";

import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { ClientAuthError, loginClient } from "@/lib/server/client-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const clientLoginSchema = z.object({
  email: z.string().trim().email("Email invalide."),
  organizationCode: z.string().trim().min(1, "Le code organisation est obligatoire."),
});

export async function POST(request: Request) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;

  const parsed = clientLoginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "Email et code organisation sont obligatoires." }, { status: 422 });
  }

  try {
    const client = await loginClient(parsed.data);
    return NextResponse.json({ client });
  } catch (error) {
    if (error instanceof ClientAuthError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json({ message: "Impossible de se connecter." }, { status: 500 });
  }
}
