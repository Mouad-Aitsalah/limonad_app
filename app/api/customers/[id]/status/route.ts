import { NextResponse } from "next/server";
import { z } from "zod";

import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { setCustomerStatus } from "@/lib/server/customers";

type RouteContext = { params: Promise<{ id: string }> };

const schema = z.object({ status: z.enum(["ACTIVE", "INACTIVE", "BLOCKED"]) });

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ message: "Statut invalide." }, { status: 422 });
  }
  try {
    return NextResponse.json({
      customer: await setCustomerStatus(id, parsed.data.status),
    });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json({ message: "Impossible de modifier le statut." }, { status: 500 });
  }
}
