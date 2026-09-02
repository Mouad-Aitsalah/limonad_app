import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { finalizeInventory, mapInventoryError } from "@/lib/server/inventories";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { reportUnexpected } from "@/lib/server/report-error";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  const { id } = await context.params;
  try {
    return NextResponse.json({ inventory: await finalizeInventory(id) });
  } catch (error) {
    reportUnexpected(error, {
      route: "POST /api/inventories/[id]/finish",
      area: "inventory",
      op: "finalizeInventory",
    });
    if (error instanceof AuthServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    const mapped = mapInventoryError(error);
    return NextResponse.json({ message: mapped.message }, { status: mapped.status });
  }
}
