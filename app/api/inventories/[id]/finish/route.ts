import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { finalizeInventory, mapInventoryError } from "@/lib/server/inventories";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    return NextResponse.json({ inventory: await finalizeInventory(id) });
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    const mapped = mapInventoryError(error);
    return NextResponse.json({ message: mapped.message }, { status: mapped.status });
  }
}
