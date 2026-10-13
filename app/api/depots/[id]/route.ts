import { NextResponse } from "next/server";

import { getDepotById, OperationsServiceError } from "@/lib/server/depots";
import { rejectDisabledModule } from "@/lib/server/module-guard";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const moduleRejection = await rejectDisabledModule(request);
  if (moduleRejection) return moduleRejection;
  const { id } = await context.params;
  try {
    return NextResponse.json({ depot: await getDepotById(id) });
  } catch (error) {
    if (error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de charger le depot." },
      { status: 500 },
    );
  }
}
