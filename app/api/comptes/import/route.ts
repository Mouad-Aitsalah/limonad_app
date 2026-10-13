import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import {
  accountImportSchema,
  applyAccountImport,
  classifyAccountImportRows,
  type AccountImportRowStatus,
} from "@/lib/server/accounts-import";
import { AuthServiceError } from "@/lib/server/auth";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { OperationsServiceError } from "@/lib/server/depots";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import { rejectDisabledModule } from "@/lib/server/module-guard";

// A file of several hundred lines is imported one short transaction at a
// time (see below); give the handler room past the default serverless limit.
export const maxDuration = 60;

/**
 * POST /api/comptes/import - the real write behind "Importer les comptes"
 * (clients, fournisseurs, charges, trésorerie, employés).
 *
 * The row list is re-validated here from scratch (classifyAccountImportRows,
 * exactly what the preview runs - the browser's statuses are never trusted),
 * then each importable line is applied in its OWN short transaction (directory
 * row + its ledger account(s) commit or roll back together). One failing line
 * is reported as ERROR / CONFLICT without rolling back the others, and
 * re-importing the same file is safe: unchanged lines come back UNCHANGED.
 *
 * Every read and write is filtered by the caller's own organizationId (from the
 * session) - no parameter of the file can point the import at another
 * organisation, and no internal id of the file is ever used. Employee lines
 * need the admin role, like /employes.
 */
export async function POST(request: Request) {
  const moduleRejection = await rejectDisabledModule(request);
  if (moduleRejection) return moduleRejection;
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  try {
    const input = accountImportSchema.parse(await request.json());
    const user = await requireOrganizationUser(["admin", "depot_manager", "cashier"]);

    if (input.rows.length === 0) {
      return NextResponse.json({ message: "Aucune ligne a importer." }, { status: 422 });
    }

    const { rows } = await classifyAccountImportRows(user.organizationId, input.rows, {
      canImportEmployees: user.role === "admin",
    });
    const results = await applyAccountImport(user.organizationId, user.id, rows);

    const countStatus = (status: AccountImportRowStatus) => results.filter((row) => row.status === status).length;
    const byType = (type: string, status: AccountImportRowStatus) =>
      results.filter((row) => row.type === type && row.status === status).length;
    const summary = {
      created: countStatus("CREATED"),
      updated: countStatus("UPDATED"),
      unchanged: countStatus("UNCHANGED"),
      conflicts: countStatus("CONFLICT"),
      errors: countStatus("ERROR"),
    };

    await prisma.auditLog.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        action: "ACCOUNTS_IMPORTED",
        entityType: "BusinessAccount",
        newValue: { lines: input.rows.length, ...summary },
      },
    });

    return NextResponse.json({
      summary,
      byType: {
        customersCreated: byType("CUSTOMER", "CREATED"),
        customersUpdated: byType("CUSTOMER", "UPDATED"),
        suppliersCreated: byType("SUPPLIER", "CREATED"),
        suppliersUpdated: byType("SUPPLIER", "UPDATED"),
        expensesCreated: byType("EXPENSE", "CREATED"),
        expensesUpdated: byType("EXPENSE", "UPDATED"),
        treasuriesCreated: byType("TREASURY", "CREATED"),
        treasuriesUpdated: byType("TREASURY", "UPDATED"),
        employeesCreated: byType("EMPLOYEE", "CREATED"),
        employeesUpdated: byType("EMPLOYEE", "UPDATED"),
      },
      rows: results,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: "Lignes import invalides." }, { status: 422 });
    }
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json({ message: "Impossible d'importer les comptes." }, { status: 500 });
  }
}
