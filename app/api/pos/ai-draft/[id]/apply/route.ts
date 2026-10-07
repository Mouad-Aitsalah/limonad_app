import { NextResponse } from "next/server";

import { applyAiPosDraft } from "@/lib/server/ai-pos-draft-pos";
import { AuthServiceError } from "@/lib/server/auth";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { OperationsServiceError } from "@/lib/server/depots";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/pos/ai-draft/[id]/apply - marks the AI-prepared cart APPLIED
 * (once: a second call answers 409). The POS fills its own cart only after
 * this succeeds. Never creates a Sale, Payment, StockMovement or entry.
 */
export async function POST(request: Request, context: RouteContext) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  const { id } = await context.params;
  try {
    return NextResponse.json({ draft: await applyAiPosDraft(id) });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json({ message: "Impossible d'ouvrir le panier préparé." }, { status: 500 });
  }
}
