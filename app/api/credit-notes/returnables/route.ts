import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { getReturnableProductsForCustomer } from "@/lib/server/credit-notes";
import { OperationsServiceError } from "@/lib/server/depots";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get("customerId");
    if (!customerId) {
      return NextResponse.json({ message: "Client obligatoire." }, { status: 422 });
    }
    return NextResponse.json({
      products: await getReturnableProductsForCustomer(customerId),
    });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de charger les produits retournables." },
      { status: 500 },
    );
  }
}
