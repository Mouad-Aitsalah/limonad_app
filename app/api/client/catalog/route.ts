import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { ClientAuthError, requireClient } from "@/lib/server/client-auth";
import { getClientCatalogPage } from "@/lib/server/client-portal-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/client/catalog?q=&categoryId=&cursor= - one page of the Espace
 * Client catalogue, searched/filtered/paginated server-side. The
 * organisation comes ONLY from the verified client session.
 */
export async function GET(request: Request) {
  try {
    const client = await requireClient();
    const url = new URL(request.url);
    const page = await getClientCatalogPage(prisma, client.organizationId, {
      q: url.searchParams.get("q") ?? undefined,
      categoryId: url.searchParams.get("categoryId") ?? undefined,
      cursor: url.searchParams.get("cursor"),
    });
    return NextResponse.json(page);
  } catch (error) {
    if (error instanceof ClientAuthError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("Erreur catalogue Espace Client :", error);
    return NextResponse.json({ message: "Impossible de charger le catalogue." }, { status: 500 });
  }
}
