import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { mapInventoryError, saveInventoryLine } from "@/lib/server/inventories";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const { line, totals } = await saveInventoryLine(id, await request.json());
    return NextResponse.json({ line, totals });
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    const mapped = mapInventoryError(error);
    return NextResponse.json(
      { message: mapped.message, fieldErrors: mapped.fieldErrors },
      { status: mapped.status },
    );
  }
}
