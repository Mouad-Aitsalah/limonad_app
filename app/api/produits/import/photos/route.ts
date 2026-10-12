import { NextResponse } from "next/server";
import { z } from "zod";

import { AuthServiceError } from "@/lib/server/auth";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { importProductPhotos, PHOTO_IMPORT_MAX_ITEMS } from "@/lib/server/data-exports";
import { OperationsServiceError } from "@/lib/server/depots";

export const maxDuration = 60;

/** A request stays well under the platform's body limit (~4.5 MB): the browser sends ~3 MB at most. */
const MAX_BODY_CHARS = 4_000_000;

const bodySchema = z.object({
  photos: z
    .array(z.object({ reference: z.string().trim().min(1).max(200), dataUrl: z.string().min(1) }))
    .min(1)
    .max(PHOTO_IMPORT_MAX_ITEMS),
});

/**
 * POST /api/produits/import/photos - photos of the products import ZIP, read and
 * prepared in the browser, sent a few at a time. Same roles as the products
 * import (admin, depot_manager). Each image is re-checked here from its content
 * (format, 2 MB) and attached to the product with that reference IN THE
 * SESSION'S organisation only.
 */
export async function POST(request: Request) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_CHARS) {
      return NextResponse.json({ message: "Lot de photos trop volumineux." }, { status: 413 });
    }
    let json: unknown = null;
    try {
      json = JSON.parse(raw);
    } catch {
      return NextResponse.json({ message: "Requête illisible." }, { status: 400 });
    }
    const body = bodySchema.parse(json);
    return NextResponse.json({ results: await importProductPhotos(body.photos) });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ message: "Lot de photos invalide." }, { status: 422 });
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json({ message: "Impossible d'importer les photos." }, { status: 500 });
  }
}
