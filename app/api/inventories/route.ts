import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { createInventory, getInventoryHistory, mapInventoryError } from "@/lib/server/inventories";

export async function GET() {
  try {
    return NextResponse.json({ inventories: await getInventoryHistory() });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de charger l'historique des inventaires." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    return NextResponse.json(
      { inventory: await createInventory(await request.json()) },
      { status: 201 },
    );
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
