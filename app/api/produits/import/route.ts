import { NextResponse } from "next/server";
import { z } from "zod";

import { describeImportValidationError } from "@/lib/products-import-rules";
import { AuthServiceError } from "@/lib/server/auth";
import { OperationsServiceError } from "@/lib/server/depots";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import { applyProductImportBatch, type ImportRowStatus } from "@/lib/server/products-import-apply";
import {
  classifyProductImportRows,
  productImportBatchSchema,
  resolveImportDepotTarget,
} from "@/lib/server/products-import";

// One request = one BATCH of a few hundred lines (the browser sends them one
// after the other). Each line is still its own short Serializable transaction;
// past PRODUCT_IMPORT_BATCH_TIME_BUDGET_MS the lines not yet started are handed
// back as `deferred`, so the request always ends before this limit.
export const maxDuration = 60;

/**
 * POST /api/produits/import - the real write behind "Importer les produits",
 * for ONE batch of lines.
 *
 * The batch is re-classified here from scratch (classifyProductImportRows,
 * exactly what the preview runs - the browser's statuses are never trusted).
 * Each importable line is then applied in its OWN Serializable transaction:
 * Product (+ a Category created on the fly) + StockLevel + StockMovement
 * commit or roll back together (§15). A failing line is reported as
 * ERROR/CONFLICT without rolling back the lines already done (§10). Stock is
 * a TARGET, not an addition: a re-import of the same file finds delta 0 and
 * writes no extra movement (§14, idempotent) - so a batch that failed half-way
 * can simply be sent again.
 *
 * Every read and write is scoped to the caller's organisation and to the
 * caller's own depot StockLocation - never a request parameter.
 */
export async function POST(request: Request) {
  let body: unknown = null;
  try {
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ message: "Requête d'import illisible." }, { status: 400 });
    }
    const input = productImportBatchSchema.parse(body);
    const user = await requireOrganizationUser(["admin", "depot_manager"]);

    if (input.rows.length === 0) {
      return NextResponse.json({ message: "Aucune ligne à importer." }, { status: 422 });
    }

    const startedAt = Date.now();
    const depot = await resolveImportDepotTarget(user.organizationId, user.id);
    const { rows } = await classifyProductImportRows(
      user.organizationId,
      depot.locationId,
      input.rows,
    );

    const outcome = await applyProductImportBatch({
      organizationId: user.organizationId,
      userId: user.id,
      locationId: depot.locationId,
      rows,
    });

    const countStatus = (status: ImportRowStatus) =>
      outcome.results.filter((row) => row.status === status).length;

    return NextResponse.json({
      summary: {
        created: countStatus("CREATED"),
        updated: countStatus("UPDATED"),
        unchanged: countStatus("UNCHANGED"),
        conflicts: countStatus("CONFLICT"),
        errors: countStatus("ERROR"),
      },
      categoriesCreated: outcome.categoriesCreated,
      stockMovementsCreated: outcome.stockMovementsCreated,
      depot: { name: depot.depotName, code: depot.depotCode },
      rows: outcome.results,
      // Lines not started because the time budget was spent: send them again.
      deferred: outcome.deferred,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { message: describeImportValidationError(error, body, "batch") },
        { status: 422 },
      );
    }
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json({ message: "Impossible d'importer les produits." }, { status: 500 });
  }
}
