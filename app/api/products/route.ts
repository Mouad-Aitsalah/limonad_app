import { NextResponse } from "next/server";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";

import { AuthServiceError } from "@/lib/server/auth";
import {
  createProduct,
  getProducts,
  ProductServiceError,
} from "@/lib/server/products";

export async function GET() {
  try {
    return NextResponse.json({ products: await getProducts() });
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { message: "Impossible de charger les produits." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
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
