import { NextResponse } from "next/server";
import { z } from "zod";

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
 * line against the caller's organisation and depot and returns NEW /
 * EXISTING_UPDATE / EXISTING_UNCHANGED / CONFLICT / ERROR. Writes nothing.
 */
export async function POST(request: Request) {
  try {
    const input = productImportSchema.parse(await request.json());
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
        reference: row.reference,
        name: row.name,
        supplierCode: row.supplierCode,
        supplierName: row.supplierName,
        categoryName: row.categoryName,
        categoryCreate: row.categoryCreate,
        purchasePriceTTC: row.purchasePriceTTC,
        salePriceTTC: row.salePriceTTC,
        taxRate: row.taxRate,
        currentStock: row.currentStock,
        targetStock: row.targetStock,
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
        { message: error instanceof z.ZodError ? "Lignes import invalides." : error.message },
        { status: error instanceof z.ZodError ? 422 : error.status },
      );
    }
    return NextResponse.json({ message: "Impossible de contrôler les produits." }, { status: 500 });
  }
}
