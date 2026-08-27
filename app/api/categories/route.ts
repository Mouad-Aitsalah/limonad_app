import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import {
  createCategory,
  getCategories,
  getCategoryOptions,
} from "@/lib/server/categories";
import { OperationsServiceError } from "@/lib/server/depots";

export async function GET() {
  try {
    const [payload, options] = await Promise.all([
      getCategories(),
      getCategoryOptions(),
    ]);

    return NextResponse.json({
      categories: payload.items,
      options,
    });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de charger les categories." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    return NextResponse.json(
      { category: await createCategory(await request.json()) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    if (error instanceof OperationsServiceError) {
      return NextResponse.json(
        { message: error.message, fieldErrors: error.fieldErrors },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { message: "Impossible de creer la categorie." },
      { status: 500 },
    );
  }
}
