import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { getCustomerJournal } from "@/lib/server/customer-settlements";
import { OperationsServiceError } from "@/lib/server/depots";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = Number(url.searchParams.get("pageSize") ?? "20");
  try {
    return NextResponse.json(
      await getCustomerJournal(id, {
        page: Number.isFinite(page) ? page : 1,
        pageSize: Number.isFinite(pageSize) ? pageSize : 20,
      }),
    );
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de charger le compte du client." },
      { status: 500 },
    );
  }
}
