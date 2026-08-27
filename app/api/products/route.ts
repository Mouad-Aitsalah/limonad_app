import { NextResponse } from "next/server";

import {
  createProduct,
  getProducts,
  ProductServiceError,
} from "@/lib/server/products";

export async function GET() {
  try {
    return NextResponse.json({ products: await getProducts() });
  } catch {
    return NextResponse.json(
      { message: "Impossible de charger les produits." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const product = await createProduct(await request.json());
    return NextResponse.json({ product }, { status: 201 });
  } catch (error) {
    if (error instanceof ProductServiceError) {
      return NextResponse.json(
        { message: error.message, fieldErrors: error.fieldErrors },
        { status: error.status },
      );
    }

    return NextResponse.json(
      { message: "Impossible de creer le produit." },
      { status: 500 },
    );
  }
}
