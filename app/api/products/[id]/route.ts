import { NextResponse } from "next/server";

import {
  getProductById,
  ProductServiceError,
  updateProduct,
} from "@/lib/server/products";

type ProductRouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: ProductRouteContext) {
  const { id } = await context.params;

  try {
    return NextResponse.json({ product: await getProductById(id) });
  } catch (error) {
    if (error instanceof ProductServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { message: "Impossible de charger le produit." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, context: ProductRouteContext) {
  const { id } = await context.params;

  try {
    const product = await updateProduct(id, await request.json());
    return NextResponse.json({ product });
  } catch (error) {
    if (error instanceof ProductServiceError) {
      return NextResponse.json(
        { message: error.message, fieldErrors: error.fieldErrors },
        { status: error.status },
      );
    }

    return NextResponse.json(
      { message: "Impossible de modifier le produit." },
      { status: 500 },
    );
  }
}
