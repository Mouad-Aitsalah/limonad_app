import { NextResponse } from "next/server";

import { getAiPosDraftForPos } from "@/lib/server/ai-pos-draft-pos";
import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { rejectDisabledModule } from "@/lib/server/module-guard";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/pos/ai-draft/[id] - the cart prepared by the AI assistant,
 * re-validated for the POS (author, organisation, status, expiry, products,
 * customer). Read-only: nothing is created and the draft stays OPEN.
 */
export async function GET(request: Request, context: RouteContext) {
  const moduleRejection = await rejectDisabledModule(request);
  if (moduleRejection) return moduleRejection;
  const { id } = await context.params;
  try {
    return NextResponse.json({ draft: await getAiPosDraftForPos(id) });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json({ message: "Impossible de charger le panier préparé." }, { status: 500 });
  }
}
