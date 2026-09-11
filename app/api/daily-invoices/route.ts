import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { getDailyInvoicesPage } from "@/lib/server/daily-invoices";
import { OperationsServiceError } from "@/lib/server/depots";

// Powers /ventes/journalieres. Read-only; org scoping and every filter are
// applied inside getDailyInvoicesPage (never trusts a client organizationId).
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const pageSizeParam = url.searchParams.get("pageSize");
    const userIdsParam = url.searchParams.get("userIds");
    const page = await getDailyInvoicesPage({
      day: url.searchParams.get("day") || undefined,
      cursor: url.searchParams.get("cursor") || undefined,
      pageSize: pageSizeParam ? Number(pageSizeParam) : undefined,
      userIds: userIdsParam
        ? userIdsParam.split(",").map((value) => value.trim()).filter(Boolean)
        : undefined,
      paymentMethod: url.searchParams.get("paymentMethod") || undefined,
    });
    return NextResponse.json(page);
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de charger les factures journalières." },
      { status: 500 },
    );
  }
}
