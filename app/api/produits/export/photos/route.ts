import { NextResponse } from "next/server";
import { z } from "zod";

import { AuthServiceError } from "@/lib/server/auth";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { exportProductPhotos } from "@/lib/server/data-exports";
import { OperationsServiceError } from "@/lib/server/depots";

const bodySchema = z.object({ references: z.array(z.string().trim().min(1).max(200)).max(500) });

/**
 * POST /api/produits/export/photos - the stored photos of some references, for
 * the ZIP export (admin only). Answers stay small: what does not fit comes back
 * in `remaining` for the next call. POST only because of the list size.
 */
export async function POST(request: Request) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  try {
    const body = bodySchema.parse(await request.json().catch(() => null));
    return NextResponse.json(await exportProductPhotos(body.references), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ message: "Demande de photos invalide." }, { status: 422 });
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json({ message: "Impossible d'exporter les photos." }, { status: 500 });
  }
}
