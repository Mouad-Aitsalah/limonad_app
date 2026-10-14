import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { dailyParamsFromSearchParams, getDailyInvoicesPage } from "@/lib/server/daily-invoices";
import { OperationsServiceError } from "@/lib/server/depots";
import { rejectDisabledModule } from "@/lib/server/module-guard";

// Powers /ventes/journalieres. Read-only; org scoping and every filter are
// applied inside getDailyInvoicesPage (never trusts a client organizationId).
export async function GET(request: Request) {
  const moduleRejection = await rejectDisabledModule(request);
  if (moduleRejection) return moduleRejection;
  try {
    const url = new URL(request.url);
    const page = await getDailyInvoicesPage(dailyParamsFromSearchParams(url.searchParams));
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
