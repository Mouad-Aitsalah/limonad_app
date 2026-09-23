import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { AuthServiceError } from "@/lib/server/auth";
import { handleMobilePreflight, withMobileCors } from "@/lib/server/mobile-cors";
import { requireOrganizationUser } from "@/lib/server/organization-context";

type ProductImageRouteContext = {
  params: Promise<{ id: string }>;
};

const DATA_URI_PATTERN = /^data:([^;,]*)(;base64)?,([\s\S]*)$/;

/**
 * ÉTAPE PERF POS 1 - "IMAGES PRODUITS": serves ONE product's photo, decoded
 * on demand from Product.imageUrl (still a plain data: URI in that column,
 * unchanged - no storage migration) instead of embedding it in every POS
 * context payload. See lib/server/product-image-url.ts's own doc comment for
 * the full rationale - toLightweightProductImageUrl is the only place that
 * ever points a client at this route, and only for a product that actually
 * has an uploaded (data:) photo.
 *
 * Same roles as the product-search endpoints this route exists to lighten
 * (searchProducts/searchPosProducts in lib/server/products.ts) - any
 * authenticated member of the product's own organization; cross-tenant
 * access is impossible (`organizationId` is always taken from the session,
 * never trusted from the URL).
 *
 * CORS: same pattern as every other /api/products/* and /api/driver/* route
 * the Android shell calls cross-origin with a Bearer token -
 * requireOrganizationUser() already accepts that Bearer transparently (see
 * lib/server/auth.ts's resolveSessionToken). GET is exempt from the CSRF
 * origin check everywhere else in this app (rejectUntrustedOrigin only gates
 * mutating methods), so nothing else is needed here beyond the CORS headers.
 *
 * Cache-Control is `immutable`: safe ONLY because the URL is versioned by
 * the product's updatedAt (`?v=...`, see toLightweightProductImageUrl) - a
 * re-uploaded photo changes updatedAt and therefore the URL, so this can
 * never serve a stale image from a shared/browser cache.
 */
export async function OPTIONS(request: Request) {
  return handleMobilePreflight(request);
}

export async function GET(request: Request, context: ProductImageRouteContext) {
  const { id } = await context.params;

  try {
    const user = await requireOrganizationUser([
      "admin",
      "depot_manager",
      "cashier",
      "driver",
    ]);

    const product = await prisma.product.findFirst({
      where: { id, organizationId: user.organizationId },
      select: { imageUrl: true },
    });

    if (!product?.imageUrl) {
      return withMobileCors(request, new NextResponse(null, { status: 404 }));
    }

    const match = DATA_URI_PATTERN.exec(product.imageUrl);
    if (!match) {
      // Not a data: URI - toLightweightProductImageUrl never points a client
      // here for one, but the image could have been replaced with an
      // external URL between that DTO being built and this request. Redirect
      // to the real image instead of failing.
      return withMobileCors(request, NextResponse.redirect(product.imageUrl));
    }

    const [, mimeType, isBase64, payload] = match;
    const bytes = isBase64
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf8");

    return withMobileCors(
      request,
      new NextResponse(bytes, {
        headers: {
          "Content-Type": mimeType || "application/octet-stream",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      }),
    );
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return withMobileCors(
        request,
        NextResponse.json({ message: error.message }, { status: error.status }),
      );
    }
    return withMobileCors(
      request,
      NextResponse.json({ message: "Impossible de charger l'image." }, { status: 500 }),
    );
  }
}
