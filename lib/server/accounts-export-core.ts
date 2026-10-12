import type { Prisma } from "@/lib/generated/prisma/client";
import type { AccountExportRow, AccountStatusCode, AccountTypeCode, CustomerTypeCode } from "@/lib/import-export/accounts-format";

/**
 * The accounts export for ONE organisation already authorised by the caller
 * (lib/server/accounts-export.ts: admin only) - one type per call, one page at a
 * time, ordered by code (unique per type in an organisation; the cursor is the
 * last code). BUSINESS values only: no internal id, no organisation, no balance
 * (a balance is an operational result, never transferred by a file).
 *
 * Employees: the /comptes list shows their two ledger accounts; the export gives
 * the EMPLOYEE record itself (code, full name, phone, hire date, salary, advance
 * and salary account codes, status) - what the import needs to recreate it with
 * the /employes rules.
 */

type Db = Prisma.TransactionClient;

export const ACCOUNT_EXPORT_PAGE_SIZE = 1000;

const statusOf = (active: boolean): AccountStatusCode => (active ? "ACTIVE" : "INACTIVE");

export async function loadAccountsExportPage(
  db: Db,
  organizationId: string,
  options: { type: AccountTypeCode; cursor: string | null; pageSize?: number; includeGps: boolean },
): Promise<{ rows: AccountExportRow[]; nextCursor: string | null }> {
  const take = Math.min(Math.max(1, options.pageSize ?? ACCOUNT_EXPORT_PAGE_SIZE), ACCOUNT_EXPORT_PAGE_SIZE) + 1;
  const after = options.cursor ? { gt: options.cursor } : undefined;
  let rows: AccountExportRow[];
  let codes: string[];

  switch (options.type) {
    case "CUSTOMER": {
      const list = await db.customer.findMany({
        where: { organizationId, ...(after ? { code: after } : {}) },
        orderBy: { code: "asc" },
        take,
        select: {
          code: true,
          name: true,
          phone: true,
          email: true,
          address: true,
          city: true,
          latitude: true,
          longitude: true,
          ice: true,
          taxId: true,
          contactName: true,
          type: true,
          creditLimit: true,
          creditLimitEnabled: true,
          notes: true,
          status: true,
        },
      });
      codes = list.map((row) => row.code);
      rows = list.map((row) => ({
        type: "CUSTOMER",
        code: row.code,
        name: row.name,
        phone: row.phone,
        email: row.email,
        address: row.address || null,
        city: row.city || null,
        // Decimal(10, 7) -> number: the 7 stored decimals are kept exactly
        latitude: options.includeGps && row.latitude ? row.latitude.toNumber() : null,
        longitude: options.includeGps && row.longitude ? row.longitude.toNumber() : null,
        ice: row.ice,
        taxId: row.taxId,
        contactName: row.contactName,
        customerType: row.type as CustomerTypeCode,
        creditLimit: row.creditLimit.toNumber(),
        creditLimitEnabled: row.creditLimitEnabled,
        notes: row.notes,
        status: row.status as AccountStatusCode,
      }));
      break;
    }
    case "SUPPLIER": {
      const list = await db.supplier.findMany({
        where: { organizationId, ...(after ? { code: after } : {}) },
        orderBy: { code: "asc" },
        take,
        select: { code: true, name: true, phone: true, email: true, address: true, city: true, ice: true, taxId: true, active: true },
      });
      codes = list.map((row) => row.code);
      rows = list.map((row) => ({
        type: "SUPPLIER",
        code: row.code,
        name: row.name,
        phone: row.phone,
        email: row.email,
        address: row.address,
        city: row.city,
        ice: row.ice,
        taxId: row.taxId,
        status: statusOf(row.active),
      }));
      break;
    }
    case "EXPENSE": {
      const list = await db.expenseAccount.findMany({
        where: { organizationId, ...(after ? { code: after } : {}) },
        orderBy: { code: "asc" },
        take,
        select: { code: true, name: true, description: true, category: true, active: true },
      });
      codes = list.map((row) => row.code);
      rows = list.map((row) => ({
        type: "EXPENSE",
        code: row.code,
        name: row.name,
        description: row.description,
        category: row.category,
        status: statusOf(row.active),
      }));
      break;
    }
    case "TREASURY": {
      const list = await db.treasuryAccount.findMany({
        where: { organizationId, ...(after ? { code: after } : {}) },
        orderBy: { code: "asc" },
        take,
        select: { code: true, name: true, kind: true, active: true },
      });
      codes = list.map((row) => row.code);
      rows = list.map((row) => ({ type: "TREASURY", code: row.code, name: row.name, treasuryKind: row.kind, status: statusOf(row.active) }));
      break;
    }
    case "EMPLOYEE": {
      const list = await db.employee.findMany({
        where: { organizationId, ...(after ? { employeeCode: after } : {}) },
        orderBy: { employeeCode: "asc" },
        take,
        select: {
          employeeCode: true,
          fullName: true,
          phone: true,
          hireDate: true,
          salary: true,
          status: true,
          advanceAccount: { select: { code: true } },
          salaryAccount: { select: { code: true } },
        },
      });
      codes = list.map((row) => row.employeeCode);
      rows = list.map((row) => ({
        type: "EMPLOYEE",
        code: row.employeeCode,
        name: row.fullName,
        phone: row.phone,
        hireDate: row.hireDate ? row.hireDate.toISOString().slice(0, 10) : null,
        salary: row.salary?.toNumber() ?? null,
        advanceAccountCode: row.advanceAccount?.code ?? null,
        salaryAccountCode: row.salaryAccount?.code ?? null,
        status: row.status as AccountStatusCode,
      }));
      break;
    }
  }

  const pageSize = take - 1;
  return { rows: rows.slice(0, pageSize), nextCursor: codes.length > pageSize ? codes[pageSize - 1] : null };
}
