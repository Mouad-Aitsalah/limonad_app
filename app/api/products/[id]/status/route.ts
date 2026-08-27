import { NextResponse } from "next/server";
import { z } from "zod";

import { ProductServiceError, setProductStatus } from "@/lib/server/products";

type ProductStatusRouteContext = {
  params: Promise<{ id: string }>;
};

const statusSchema = z.object({
  active: z.boolean(),
});

export async function PATCH(request: Request, context: ProductStatusRouteContext) {
  const { id } = await context.params;
  const parsed = statusSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json(
      { message: "Statut invalide." },
      { status: 422 },
    );
  }

  try {
    const product = await setProductStatus(id, parsed.data.active);
    return NextResponse.json({ product });
  } catch (error) {
    if (error instanceof ProductServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { message: "Impossible de modifier le statut du produit." },
      { status: 500 },
    );
  }
}
