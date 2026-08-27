import { NextResponse } from "next/server";
import { z } from "zod";

import { OperationsServiceError } from "@/lib/server/depots";
import { setTruckStatus } from "@/lib/server/trucks";

type RouteContext = { params: Promise<{ id: string }> };

const schema = z.object({ active: z.boolean() });

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ message: "Statut invalide." }, { status: 422 });
  }

  try {
    return NextResponse.json({
      truck: await setTruckStatus(id, parsed.data.active),
    });
  } catch (error) {
    if (error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de modifier le statut." },
      { status: 500 },
    );
  }
}
