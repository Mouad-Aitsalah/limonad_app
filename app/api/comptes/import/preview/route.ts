import { NextResponse } from "next/server";
import { z } from "zod";

import { accountImportSchema, classifyAccountImportRows } from "@/lib/server/accounts-import";
import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import { rejectDisabledModule } from "@/lib/server/module-guard";

/**
 * POST /api/comptes/import/preview - read only: what the import would do with
 * each line (NEW / UPDATE with old -> new values / UNCHANGED / CONFLICT / ERROR).
 * Same roles as the import; employee lines need the admin role (as /employes).
 */
export async function POST(request: Request) {
  const moduleRejection = await rejectDisabledModule(request);
  if (moduleRejection) return moduleRejection;
  try {
    const input = accountImportSchema.parse(await request.json());
    const user = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);
    const { rows, summary } = await classifyAccountImportRows(user.organizationId, input.rows, {
      canImportEmployees: user.role === "admin",
    });
    // The preview is read-only: the internal existingId never leaves the server.
    return NextResponse.json({
      summary,
      rows: rows.map((row) => ({
        excelRow: row.excelRow,
        code: row.code,
        name: row.name ?? null,
        type: row.type,
        phone: row.phone ?? null,
        accountingCode: row.accountingCode,
        status: row.status,
        message: row.message,
        changes: row.changes,
      })),
    });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError || error instanceof z.ZodError) {
      return NextResponse.json(
        { message: error instanceof z.ZodError ? describeAccountIssue(error) : error.message },
        { status: error instanceof z.ZodError ? 422 : error.status },
      );
    }
    return NextResponse.json({ message: "Impossible de controler les comptes." }, { status: 500 });
  }
}

function describeAccountIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (issue?.code === "too_big" && issue.path.length === 1) return "Le fichier depasse 2 000 lignes.";
  return issue && typeof issue.path[2] === "string" ? `Lignes import invalides (champ ${issue.path[2]}).` : "Lignes import invalides.";
}
