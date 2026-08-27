import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { setCategoryStatus } from "@/lib/server/categories";
import { OperationsServiceError } from "@/lib/server/depots";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as { active?: boolean };

    if (typeof body.active !== "boolean") {
      return NextResponse.json(
        { message: "Le statut de la categorie est invalide." },
        { status: 422 },
      );
    }

    return NextResponse.json({
      category: await setCategoryStatus(id, body.active),
    });
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    if (error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de modifier le statut de la categorie." },
      { status: 500 },
    );
  }
}
