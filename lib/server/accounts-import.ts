import "server-only";

import { prisma } from "@/lib/prisma";
import {
  applyAccountImportRows,
  classifyAccountImportRowsWith,
  type AccountImportRowResult,
  type ClassifiedAccountRow,
  type AccountImportSummary,
} from "@/lib/server/accounts-import-core";
import type { AccountImportLine } from "@/lib/import-export/accounts-format";

/**
 * Server entry of the accounts import (feuille "Comptes" / CSV): the real
 * database client bound to the core (lib/server/accounts-import-core.ts, which
 * holds every rule and is tested on a database). Everything is scoped to the
 * single organizationId of the caller's session, given by the route.
 */

export {
  ACCOUNT_IMPORT_MAX_ROWS,
  accountImportSchema,
  type AccountImportRowResult,
  type AccountImportRowStatus,
  type AccountImportSummary,
  type ClassifiedAccountRow,
} from "@/lib/server/accounts-import-core";

export async function classifyAccountImportRows(
  organizationId: string,
  rows: AccountImportLine[],
  options: { canImportEmployees: boolean },
): Promise<{ rows: ClassifiedAccountRow[]; summary: AccountImportSummary }> {
  return classifyAccountImportRowsWith(prisma, organizationId, rows, options);
}

/** Each line in its own short transaction (one failing line never rolls the others back). */
export async function applyAccountImport(
  organizationId: string,
  userId: string,
  rows: ClassifiedAccountRow[],
): Promise<AccountImportRowResult[]> {
  return applyAccountImportRows((work) => prisma.$transaction((tx) => work(tx), { timeout: 20_000 }), organizationId, userId, rows);
}
