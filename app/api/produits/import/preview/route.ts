import { NextResponse } from "next/server";
import { z } from "zod";

import { describeImportValidationError } from "@/lib/products-import-rules";
import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import {
  classifyProductImportRows,
  productImportSchema,
  resolveImportDepotTarget,
} from "@/lib/server/products-import";

/**
 * POST /api/produits/import/preview - read-only. Classifies every submitted
 * line of the WHOLE file (one request, so a reference used twice is a conflict
 * file-wide) against the caller's organisation and depot and returns NEW /
 * EXISTING_UPDATE / EXISTING_UNCHANGED / CONFLICT / ERROR. Writes nothing, and
 * runs 4 grouped reads (6 SQL SELECTs) whatever the number of lines.
 *
 * The response only carries what the browser does not already have: it keeps the
 * file's own cells (reference, prices, ...) and is matched by `excelRow`, which
 * keeps a 15 000-line answer well under the 4.5 MB response limit of the host.
 */
export async function POST(request: Request) {
  let body: unknown = null;
  try {
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ message: "Requête de contrôle illisible." }, { status: 400 });
    }
    const input = productImportSchema.parse(body);
    const user = await requireOrganizationUser(["admin", "depot_manager"]);
    const depot = await resolveImportDepotTarget(user.organizationId, user.id);
    const { rows, summary } = await classifyProductImportRows(
      user.organizationId,
      depot.locationId,
      input.rows,
    );

    return NextResponse.json({
      depot: { name: depot.depotName, code: depot.depotCode },
      summary,
      rows: rows.map((row) => ({
        excelRow: row.excelRow,
        supplierName: row.supplierName,
        supplierCreate: row.supplierCreate,
        categoryCreate: row.categoryCreate,
        currentStock: row.currentStock,
        status: row.status,
        message: row.message,
        changes: row.changes,
      })),
    });
  } catch (error) {
    if (
      error instanceof AuthServiceError ||
      error instanceof OperationsServiceError ||
      error instanceof z.ZodError
    ) {
      return NextResponse.json(
        {
          message:
            error instanceof z.ZodError ? describeImportValidationError(error, body, "file") : error.message,
        },
        { status: error instanceof z.ZodError ? 422 : error.status },
      );
    }
    return NextResponse.json({ message: "Impossible de contrôler les produits." }, { status: 500 });
  }
}
