import { NextResponse } from "next/server";
import { z } from "zod";

import { accountImportSchema, classifyAccountImportRows } from "@/lib/server/accounts-import";
import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { requireOrganizationUser } from "@/lib/server/organization-context";

export async function POST(request: Request) {
  try {
    const input = accountImportSchema.parse(await request.json());
    const user = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
    const { rows, summary } = await classifyAccountImportRows(user.organizationId, input.rows);
    // The preview is read-only: drop the internal existingId before it leaves the server.
    return NextResponse.json({
      summary,
      rows: rows.map((row) => ({
        excelRow: row.excelRow,
        code: row.code,
        name: row.name,
        type: row.type,
        phone: row.phone,
        accountingCode: row.accountingCode,
        status: row.status,
        message: row.message,
        changes: row.changes,
      })),
    });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError || error instanceof z.ZodError) {
      return NextResponse.json(
        { message: error instanceof z.ZodError ? "Lignes import invalides." : error.message },
        { status: error instanceof z.ZodError ? 422 : error.status },
      );
    }
    return NextResponse.json({ message: "Impossible de controler les comptes." }, { status: 500 });
  }
}
